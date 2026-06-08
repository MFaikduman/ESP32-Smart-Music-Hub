# Sesli Müzik Kontrol Sistemi

Bu proje, GitHub Pages üzerinde tamamen statik olarak çalışan bir müzik kontrol uygulamasıdır. Kullanıcılar şarkıları arayüzdeki butonlarla, klavye kısayollarıyla veya Türkçe sesli komutlarla yönetebilir.

## Dosya Yapısı

```text
/
├── index.html
├── style.css
├── script.js
├── README.md
└── assets/
    ├── music/
    │   ├── Jurrivh - First Love (SlowVerb) [Nza2D_Z1Ono].mp3
    │   ├── Paul Cardall - Ascensus Christi_ A Piano Rhapsody (Official Video) [LBoQ1W5VWx4].mp3
    │   └── See You Again - Sad & Emotional Piano Song Instrumental [dz5EVMSdN0w].mp3
    └── images/
        └── default-cover.svg
```

MP3 dosyaları `assets/music/` klasörü altında tutulur.

## GitHub Pages Üzerinden Yayınlama

1. Bu dosyaları bir GitHub deposuna yükleyin.
2. GitHub deposunda `Settings` bölümüne girin.
3. `Pages` sekmesini açın.
4. `Build and deployment` alanında kaynak olarak ilgili branch'i seçin.
5. Kök dizini yayınlamak için `/root` seçeneğini kullanın.
6. Kaydettikten sonra GitHub Pages bağlantısının oluşmasını bekleyin.

Uygulama backend, veritabanı, Node.js, npm veya harici API gerektirmez.

## Yeni MP3 Ekleme

1. Yeni MP3 dosyanızı `assets/music/` klasörüne koyun.
2. Dosya adında boşluk ve Türkçe karakter kullanmamaya özen gösterin.
3. `script.js` dosyasının başındaki `songs` dizisine yeni şarkıyı ekleyin.

Örnek:

```js
{
  title: "Yeni Şarkı",
  artist: "Yeni Sanatçı",
  src: "assets/music/yeni-sarki.mp3",
  cover: "assets/images/default-cover.svg"
}
```

## songs Dizisini Güncelleme

`script.js` dosyasının en üstündeki `songs` dizisi şarkı listesini belirler. Her kayıt için şu alanlar kullanılır:

- `title`: Ekranda görünen şarkı adı
- `artist`: Sanatçı adı
- `src`: MP3 dosyasının relative path yolu
- `cover`: Albüm kapağı yolu

GitHub Pages alt dizinlerinde de çalışması için yolları `assets/...` biçiminde relative yazın. `/assets/...` gibi kökten başlayan yollar kullanmayın.

## Mikrofon İzni

Sesli komutları kullanmak için uygulamadaki `Mikrofonu Aç` düğmesine basın ve tarayıcının mikrofon izni isteğini onaylayın. İzin reddedilirse tarayıcının adres çubuğundaki site ayarlarından mikrofon iznini tekrar açabilirsiniz.

## Sesli Komutlar

- `oynat`: Müziği oynatır.
- `devam et`: Müziği oynatır.
- `duraklat`: Müziği duraklatır.
- `durdur`: Müziği duraklatır.
- `sonraki`: Sonraki şarkıya geçer.
- `sonraki şarkı`: Sonraki şarkıya geçer.
- `önceki`: Önceki şarkıya geçer.
- `önceki şarkı`: Önceki şarkıya geçer.
- `ses aç`: Sesi yüzde 10 artırır.
- `ses yükselt`: Sesi yüzde 10 artırır.
- `ses kıs`: Sesi yüzde 10 azaltır.
- `sessiz`: Sesi sıfırlar.
- `başa sar`: Şarkıyı başa alır.

## Klavye Kontrolleri

- `Space`: Oynat veya duraklat
- `Sağ ok`: 5 saniye ileri
- `Sol ok`: 5 saniye geri
- `Yukarı ok`: Sesi artır
- `Aşağı ok`: Sesi azalt

## Tarayıcı Desteği

Sesli kontrol tarayıcının Web Speech API özelliğini kullanır. Bu API desteği tarayıcıya ve sürüme göre değişebilir. En iyi sonuç için güncel Google Chrome veya Microsoft Edge kullanmanız önerilir.

MP3 dosyası bulunamazsa veya yüklenemezse uygulama arayüzde hata mesajı gösterir ve çalışmaya devam eder.
