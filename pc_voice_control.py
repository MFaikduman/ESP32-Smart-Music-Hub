import serial
import time
import ctypes
import re
from ctypes import POINTER, cast

import comtypes
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume


SERIAL_PORT = "COM12"   # ESP32 hangi COM porttaysa burayı değiştir
BAUD_RATE = 115200

LOW_VOLUME = 0.20
HIGH_VOLUME = 1.00

VK_MEDIA_NEXT_TRACK = 0xB0
KEYEVENTF_KEYUP = 0x0002

COMMANDS = ["VOLUME_DOWN", "VOLUME_UP", "MUTE", "NEXT"]


def get_volume_controller():
    comtypes.CoInitialize()

    devices = AudioUtilities.GetSpeakers()

    if hasattr(devices, "EndpointVolume"):
        return devices.EndpointVolume

    interface = devices.Activate(
        IAudioEndpointVolume._iid_,
        CLSCTX_ALL,
        None
    )

    return cast(interface, POINTER(IAudioEndpointVolume))


def press_next_track():
    ctypes.windll.user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, 0, 0)
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, KEYEVENTF_KEYUP, 0)


def extract_command(line):
    for command in COMMANDS:
        if command in line:
            return command
    return None


def print_prediction(line):
    """
    ESP32'nin uzun tahmin çıktısını sadeleştirir.
    Örnek:
    DEBUG En iyi sinif: sesi_kapat skor=0.996 ...
    """
    match = re.search(r"En iyi sinif:\s*(\S+)\s*skor=([0-9.]+)", line)

    if match:
        label = match.group(1)
        score = float(match.group(2)) * 100
        print(f"[AI] {label} %{score:.1f}")


def handle_command(command, volume):
    print(f"[CMD] {command}")

    if command == "VOLUME_DOWN":
        volume.SetMute(0, None)
        volume.SetMasterVolumeLevelScalar(LOW_VOLUME, None)

        current = volume.GetMasterVolumeLevelScalar()
        print(f"[PC] Ses %{int(current * 100)} seviyesine alindi")

    elif command == "VOLUME_UP":
        volume.SetMute(0, None)
        volume.SetMasterVolumeLevelScalar(HIGH_VOLUME, None)

        current = volume.GetMasterVolumeLevelScalar()
        print(f"[PC] Ses %{int(current * 100)} seviyesine alindi")

    elif command == "MUTE":
        is_muted = volume.GetMute()

        if is_muted:
            volume.SetMute(0, None)
            print("[PC] Ses acildi")
        else:
            volume.SetMute(1, None)
            print("[PC] Ses kapatildi")

    elif command == "NEXT":
        press_next_track()
        print("[PC] Sonraki muzige gecildi")


def main():
    print("===================================")
    print(" PC Voice Control basladi")
    print("===================================")
    print(f"Port: {SERIAL_PORT}")
    print("Arduino Serial Monitor kapali olmali.")
    print("Beklenen komutlar: VOLUME_DOWN, VOLUME_UP, MUTE, NEXT")
    print("-----------------------------------")

    try:
        volume = get_volume_controller()
        current = volume.GetMasterVolumeLevelScalar()
        print(f"[PC] Ses kontrolcusu hazir. Mevcut ses: %{int(current * 100)}")
    except Exception as e:
        print("[HATA] Ses kontrolcusu alinamadi:")
        print(e)
        return

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)
        ser.reset_input_buffer()
        print("[SERIAL] ESP32 dinleniyor...")
        print("-----------------------------------")
    except Exception as e:
        print("[HATA] Seri port acilamadi:")
        print(e)
        return

    try:
        while True:
            line = ser.readline().decode(errors="ignore").strip()

            if not line:
                continue

            # Tahmin sonucunu sade göster
            if "DEBUG En iyi sinif:" in line:
                print_prediction(line)
                continue

            # Komut varsa işle
            command = extract_command(line)

            if command:
                handle_command(command, volume)
                print("-----------------------------------")

            # Komut dışı önemli durumları kısa göster
            elif "Komut disi ses" in line:
                print("[AI] Komut disi ses / ortam")

            elif "Guven dusuk" in line:
                print("[AI] Guven dusuk, islem yok")

            elif "Cooldown aktif" in line:
                print("[AI] Cooldown aktif, islem yok")

    except KeyboardInterrupt:
        print("\nProgram kapatildi.")

    finally:
        ser.close()


if __name__ == "__main__":
    main()