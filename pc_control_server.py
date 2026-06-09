import argparse
import ctypes
import json
import queue
import re
import threading
import time
from ctypes import POINTER, cast
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_SERIAL_PORT = "COM12"
DEFAULT_BAUD_RATE = 115200
LOW_VOLUME = 0.20
HIGH_VOLUME = 1.00

VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
KEYEVENTF_KEYUP = 0x0002

COMMANDS = ["VOLUME_DOWN", "VOLUME_UP", "MUTE", "PREVIOUS", "NEXT"]
ROOT_DIR = Path(__file__).resolve().parent


class PcControlState:
    def __init__(self):
        self.lock = threading.Lock()
        self.listeners = []
        self.serial_thread = None
        self.serial_handle = None
        self.serial_stop = threading.Event()
        self.serial_connected = False
        self.serial_port = DEFAULT_SERIAL_PORT
        self.baud_rate = DEFAULT_BAUD_RATE
        self.volume_percent = None
        self.muted = False
        self.last_prediction = None
        self.last_command = None
        self.last_command_source = None
        self.last_message = "Servis hazir"
        self.error = False
        self.command_event_id = 0
        self.log = []

    def snapshot(self):
        with self.lock:
            return self._snapshot_locked()

    def update(self, log=None, **kwargs):
        with self.lock:
            for key, value in kwargs.items():
                setattr(self, key, value)
            if log:
                self.log.insert(0, log)
                self.log = self.log[:30]
            snapshot = self._snapshot_locked()

        self.broadcast(snapshot)
        return snapshot

    def record_command(self, command, source):
        label = source.upper() if source else "CMD"
        with self.lock:
            self.command_event_id += 1
            self.last_command = command
            self.last_command_source = source
            self.last_message = f"{command} komutu alindi"
            self.error = False
            self.log.insert(0, f"[{label}] {command}")
            self.log = self.log[:30]
            snapshot = self._snapshot_locked()

        self.broadcast(snapshot)
        return snapshot

    def subscribe(self):
        listener = queue.Queue(maxsize=20)
        with self.lock:
            self.listeners.append(listener)
        return listener

    def unsubscribe(self, listener):
        with self.lock:
            if listener in self.listeners:
                self.listeners.remove(listener)

    def broadcast(self, snapshot):
        with self.lock:
            listeners = list(self.listeners)

        for listener in listeners:
            try:
                listener.put_nowait(snapshot)
            except queue.Full:
                pass

    def _snapshot_locked(self):
        return {
            "serial_connected": self.serial_connected,
            "serial_port": self.serial_port,
            "baud_rate": self.baud_rate,
            "volume_percent": self.volume_percent,
            "muted": self.muted,
            "last_prediction": self.last_prediction,
            "last_command": self.last_command,
            "last_command_source": self.last_command_source,
            "last_message": self.last_message,
            "error": self.error,
            "command_event_id": self.command_event_id,
            "log": list(self.log),
        }


state = PcControlState()


def get_volume_controller():
    import comtypes
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

    comtypes.CoInitialize()
    devices = AudioUtilities.GetSpeakers()

    if hasattr(devices, "EndpointVolume"):
        return devices.EndpointVolume

    interface = devices.Activate(
        IAudioEndpointVolume._iid_,
        CLSCTX_ALL,
        None,
    )
    return cast(interface, POINTER(IAudioEndpointVolume))


def refresh_volume_state():
    try:
        volume = get_volume_controller()
        current = int(round(volume.GetMasterVolumeLevelScalar() * 100))
        muted = bool(volume.GetMute())
        return state.update(volume_percent=current, muted=muted, error=False)
    except Exception as exc:
        return state.update(last_message=f"Ses kontrolcusu alinamadi: {exc}", error=True)


def press_media_key(vk_code):
    ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)


def extract_command(line):
    for command in COMMANDS:
        if command in line:
            return command
    return None


def parse_prediction(line):
    match = re.search(r"En iyi sinif:\s*(\S+)\s*skor=([0-9.]+)", line)
    if not match:
        return None

    return {
        "label": match.group(1),
        "score": float(match.group(2)) * 100,
    }


def handle_command(command, source="panel"):
    command = command.upper()

    if command not in COMMANDS:
        return state.update(last_message=f"Bilinmeyen komut: {command}", error=True)

    state.record_command(command, source)

    try:
        if command == "VOLUME_DOWN":
            volume = get_volume_controller()
            volume.SetMute(0, None)
            volume.SetMasterVolumeLevelScalar(LOW_VOLUME, None)
            current = int(round(volume.GetMasterVolumeLevelScalar() * 100))
            return state.update(
                volume_percent=current,
                muted=False,
                last_message=f"Ses %{current} seviyesine alindi",
                error=False,
            )

        if command == "VOLUME_UP":
            volume = get_volume_controller()
            volume.SetMute(0, None)
            volume.SetMasterVolumeLevelScalar(HIGH_VOLUME, None)
            current = int(round(volume.GetMasterVolumeLevelScalar() * 100))
            return state.update(
                volume_percent=current,
                muted=False,
                last_message=f"Ses %{current} seviyesine alindi",
                error=False,
            )

        if command == "MUTE":
            volume = get_volume_controller()
            muted = bool(volume.GetMute())
            volume.SetMute(0 if muted else 1, None)
            new_muted = not muted
            return state.update(
                muted=new_muted,
                last_message="Ses acildi" if muted else "Ses kapatildi",
                error=False,
            )

        if command == "PREVIOUS":
            press_media_key(VK_MEDIA_PREV_TRACK)
            return state.update(last_message="Onceki muzige gecildi", error=False)

        if command == "NEXT":
            press_media_key(VK_MEDIA_NEXT_TRACK)
            return state.update(last_message="Sonraki muzige gecildi", error=False)

    except Exception as exc:
        return state.update(last_message=f"Komut uygulanamadi: {exc}", error=True, log=f"[HATA] {exc}")

    return state.snapshot()


def process_serial_line(line):
    if "DEBUG En iyi sinif:" in line:
        prediction = parse_prediction(line)
        if prediction:
            label = prediction["label"]
            score = prediction["score"]
            state.update(
                last_prediction=prediction,
                last_message=f"AI: {label} %{score:.1f}",
                error=False,
                log=f"[AI] {label} %{score:.1f}",
            )
        return

    command = extract_command(line)
    if command:
        handle_command(command, "serial")
        return

    if "Komut disi ses" in line:
        state.update(last_message="Komut disi ses / ortam", error=False, log="[AI] Komut disi ses / ortam")
        return

    if "Guven dusuk" in line:
        state.update(last_message="Guven dusuk, islem yok", error=False, log="[AI] Guven dusuk")
        return

    if "Cooldown aktif" in line:
        state.update(last_message="Cooldown aktif, islem yok", error=False, log="[AI] Cooldown aktif")


def serial_worker(port, baud_rate):
    ser = None

    try:
        import serial

        ser = serial.Serial(port, baud_rate, timeout=1)
        with state.lock:
            state.serial_handle = ser
        time.sleep(2)
        ser.reset_input_buffer()
        state.update(
            serial_connected=True,
            serial_port=port,
            baud_rate=baud_rate,
            last_message="ESP32 dinleniyor",
            error=False,
            log=f"[SERIAL] {port} dinleniyor",
        )

        while not state.serial_stop.is_set():
            line = ser.readline().decode(errors="ignore").strip()
            if line:
                process_serial_line(line)

    except Exception as exc:
        if state.serial_stop.is_set():
            state.update(
                serial_connected=False,
                last_message="Seri baglanti kapatildi",
                error=False,
                log="[SERIAL] Baglanti kapatildi",
            )
        else:
            state.update(
                serial_connected=False,
                last_message=f"Seri port acilamadi: {exc}",
                error=True,
                log=f"[HATA] Seri port: {exc}",
            )

    finally:
        if ser:
            try:
                ser.close()
            except Exception:
                pass
        with state.lock:
            state.serial_handle = None
        state.update(serial_connected=False)


def start_serial(port, baud_rate):
    stop_serial(log_message=False)
    state.serial_stop.clear()
    state.update(
        serial_port=port,
        baud_rate=baud_rate,
        serial_connected=False,
        last_message="Seri port aciliyor",
        error=False,
        log=f"[SERIAL] {port} aciliyor",
    )
    thread = threading.Thread(target=serial_worker, args=(port, baud_rate), daemon=True)
    with state.lock:
        state.serial_thread = thread
    thread.start()
    return state.snapshot()


def stop_serial(log_message=True):
    state.serial_stop.set()

    with state.lock:
        serial_handle = state.serial_handle
        thread = state.serial_thread

    if serial_handle:
        try:
            serial_handle.close()
        except Exception:
            pass

    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=1.5)

    with state.lock:
        state.serial_thread = None

    if log_message:
        return state.update(
            serial_connected=False,
            last_message="Seri baglanti kapatildi",
            error=False,
            log="[SERIAL] Baglanti kapatildi",
        )

    return state.update(serial_connected=False)


class PcControlRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/pc-control/status":
            self.send_json(state.snapshot())
            return

        if path == "/api/pc-control/events":
            self.send_events()
            return

        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self.read_json()

        if path == "/api/pc-control/connect":
            port = str(data.get("port") or DEFAULT_SERIAL_PORT).strip() or DEFAULT_SERIAL_PORT
            baud_rate = int(data.get("baud_rate") or DEFAULT_BAUD_RATE)
            self.send_json(start_serial(port, baud_rate))
            return

        if path == "/api/pc-control/disconnect":
            self.send_json(stop_serial())
            return

        if path == "/api/pc-control/command":
            command = str(data.get("command") or "").upper()
            self.send_json(handle_command(command, "panel"))
            return

        self.send_json({"error": "Not found"}, status=404)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}

        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_events(self):
        listener = state.subscribe()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            self.write_event(state.snapshot())

            while True:
                try:
                    snapshot = listener.get(timeout=20)
                    self.write_event(snapshot)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            state.unsubscribe(listener)

    def write_event(self, payload):
        body = f"data: {json.dumps(payload)}\n\n".encode("utf-8")
        self.wfile.write(body)
        self.wfile.flush()

    def log_message(self, format, *args):
        return


def main():
    parser = argparse.ArgumentParser(description="ESP32 Smart Music Hub local PC control server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--serial-port", default=DEFAULT_SERIAL_PORT)
    parser.add_argument("--baud-rate", type=int, default=DEFAULT_BAUD_RATE)
    args = parser.parse_args()

    state.serial_port = args.serial_port
    state.baud_rate = args.baud_rate
    refresh_volume_state()

    handler = partial(PcControlRequestHandler, directory=str(ROOT_DIR))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print("===================================")
    print(" ESP32 Smart Music Hub PC Control")
    print("===================================")
    print(f"Adres: http://{args.host}:{args.port}")
    print(f"Varsayilan seri port: {args.serial_port}")
    print("Durdurmak icin Ctrl+C")
    print("-----------------------------------")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServis kapatiliyor.")
    finally:
        stop_serial(log_message=False)
        server.server_close()


if __name__ == "__main__":
    main()
