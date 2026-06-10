# Adaptif Araç Ses Sistemi

Bu proje, ESP32 tabanlı ses/komut algılama devresi ile kontrol edilen web tabanlı bir müzik çalar arayüzüdür. ESP32 seri port üzerinden komut gönderir; bilgisayardaki Python kontrol servisi bu komutları okuyup Windows ses seviyesini ve web müzik çaları yönetir.

## Devre Fotoğrafları

Genel breadboard kurulumu:

![ESP32 breadboard devresi](assets/images/Devre1.jpeg)

ESP32 ve bağlantı kablolarının yakın planı:

![ESP32 yakın plan devre bağlantıları](assets/images/Devre2.jpeg)

## Devredeki Parçalar

* ESP32-S3 geliştirme kartı
* Breadboard
* Ses algılama / mikrofon modülü
* Potansiyometre veya rotary encoder olarak kullanılan kontrol parçası
* Basma butonu
* Jumper kablolar
* USB kablosu

ESP32, devreden gelen girişleri okuyup seri porta komut metni yazar. Bilgisayarda çalışan Python servisi de bu komutları yakalayarak ses seviyesini, sessize alma durumunu ve şarkı geçişlerini uygular.

> Not: ESP32 firmware dosyası bu repoda bulunmadığı için kesin GPIO pin numaraları README içinde uydurulmadı. Pin eşleşmeleri ESP32 kodundaki tanımlarla kontrol edilmelidir.

## Port ve Bağlantı Ayarları

| Ayar | Değer |
| --- | --- |
| Varsayılan seri port | `COM12` |
| Baud rate | `115200` |
| Yerel PC kontrol adresi | `http://127.0.0.1:8765` |
| Web arayüzü PC API yolu | `/api/pc-control` |

ESP32 hangi COM portunda görünüyorsa `COM12` yerine o port yazılmalıdır. Arduino IDE Serial Monitor açıksa Python servisi porta bağlanamayabilir; bu yüzden servis çalıştırılırken Serial Monitor kapalı olmalıdır.

## Pot / Encoder ve Buton Mantığı

Devredeki pot/encoder ve buton, ESP32 tarafında kullanıcı girdisi üretir. ESP32 bu girdileri aşağıdaki komut isimlerinden birine çevirip seri porttan gönderir:

| Komut | Etki |
| --- | --- |
| `VOLUME_DOWN` | Sesi düşük seviyeye alır, bu projede `%20` |
| `VOLUME_UP` | Sesi yüksek seviyeye alır, bu projede `%100` |
| `MUTE` | Sesi kapatır veya tekrar açar |
| `NEXT` | Sonraki şarkıya geçer |
| `PREVIOUS` | Önceki şarkıya geçer |

Web arayüzündeki ses çubuğu kullanıcı tarafından elle de kontrol edilebilir. ESP32'den gelen komutlar ise aynı arayüzü ve Windows sesini birlikte günceller.

## Özellikler

* Müzik oynatma ve duraklatma
* Önceki / sonraki şarkıya geçme
* Ses seviyesini ayarlama
* ESP32 seri port komutlarını PC üzerinden dinleme
* Windows sesini Python servisiyle kontrol etme
* PC kontrol panelinde son komut, AI tahmini ve ses durumunu gösterme
* Koyu / açık tema desteği
* GitHub Pages üzerinden statik yayınlama

## Proje Yapısı

```text
/
|-- index.html
|-- style.css
|-- script.js
|-- pc_control_server.py
|-- pc_voice_control.py
|-- README.md
`-- assets/
    |-- music/
    |   |-- song1.mp3
    |   |-- song3.mp3
    |   `-- Metallica - Nothing Else Matters (...).m4a
    `-- images/
        |-- Devre1.jpeg
        |-- Devre2.jpeg
        |-- MaviPlak.png
        |-- KırmızıPlak.png
        |-- YesilPlak.png
        `-- default-cover.svg
```

## Çalıştırma

Gerekli Python kütüphaneleri:

```bash
pip install pyserial pycaw comtypes
```

PC kontrol servisini başlatmak için:

```bash
python pc_control_server.py --serial-port COM12
```

Daha sonra tarayıcıda şu adres açılır:

```text
http://127.0.0.1:8765
```

Servis açıldığında web arayüzündeki PC Kontrol paneli ESP32 bağlantısını, son seri komutu, AI tahminini ve PC ses durumunu göstermeye başlar.

## Müzik Ekleme

Yeni ses dosyalarını `assets/music` klasörüne ekleyip `script.js` içindeki `songs` listesini güncelleyin:

```javascript
const songs = [
  {
    title: "Şarkı Adı",
    artist: "Sanatçı Adı",
    src: "assets/music/song1.mp3",
    cover: "assets/images/MaviPlak.png"
  }
];
```

## GitHub Pages Yayını

GitHub Pages için:

```text
Settings -> Pages -> Deploy from a branch
```

Ardından `main` branch ve `/root` klasörü seçilir.
