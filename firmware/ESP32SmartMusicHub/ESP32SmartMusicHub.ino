#include <esp32-voice-control_inferencing.h>
#include "driver/i2s_std.h"

// =====================
// I2S Mikrofon Pinleri
// =====================
// INMP441 mikrofon modülünün ESP32-S3'e bağlı olduğu pinlerdir.
#define I2S_BCLK 14   // Bit Clock pini
#define I2S_WS   15   // Word Select / LRCLK pini
#define I2S_DIN  16   // Mikrofon veri giriş pini

// =====================
// Buton ve RGB LED Pinleri
// =====================
#define BUTTON_PIN 4

// ESP32-S3 N16R8 kartlarda dahili RGB LED genelde GPIO48 üzerindedir.
// Kart modeline göre değişebilir. LED yanmazsa bu pin değiştirilmelidir.
#define RGB_LED_PIN 48

// Edge Impulse modelinin istediği örnek sayısı kadar ses verisi tutulur.
// Bu buffer sınıflandırma işleminde ham ses verisi olarak kullanılır.
static int16_t audio_buffer[EI_CLASSIFIER_RAW_SAMPLE_COUNT];

// I2S mikrofon okuma kanalı için handle değişkeni
i2s_chan_handle_t rx_handle;

// Mikrofon/sistem açık-kapalı durumunu tutar.
// true  -> sistem aktif, mikrofon dinliyor
// false -> sistem kapalı, mikrofon dinlemiyor
bool systemEnabled = true;

// =====================
// Güvenlik Filtreleri
// =====================
// Modelin verdiği en yüksek tahmin skoru bu değerin altında kalırsa komut kabul edilmez.
const float CONFIDENCE_THRESHOLD = 0.85;

// En iyi sınıf ile ikinci sınıf arasındaki fark bu değerden küçükse komut kabul edilmez.
// Böylece model kararsız kaldığında yanlış komut gönderilmesi engellenir.
const float MARGIN_THRESHOLD = 0.25;

// =====================
// Aynı Komut Tekrar Kontrolü
// =====================
// Algılanan son komut etiketi
String pendingLabel = "";

// Aynı komutun kaç kez arka arkaya algılandığını tutar
int pendingCount = 0;

// Bir komutun çalışması için kaç kez üst üste algılanması gerektiği.
// 1 olursa tek algılamada komut çalışır.
// 2 yapılırsa aynı komut iki analizde üst üste gelmelidir.
const int REQUIRED_REPEAT = 1;

// =====================
// Komutlar Arası Bekleme
// =====================
// Son komutun gönderildiği zaman
unsigned long lastCommandTime = 0;

// Aynı anda veya çok kısa sürede art arda komut gönderilmesini engeller.
const unsigned long commandCooldown = 1500;

// =====================
// Buton Interrupt ve Debounce Değişkenleri
// =====================
// ISR içinde değiştirilen değişken volatile olmalıdır.
// Butona basıldığında kesme çalışır ve bu bayrak true yapılır.
volatile bool buttonInterruptFlag = false;

// Butonun mekanik titreşimlerinden dolayı aynı basışın birden fazla algılanmasını engeller.
unsigned long lastButtonInterruptTime = 0;

// Butonun kararlı kabul edilmesi için bekleme süresi
const unsigned long debounceDelay = 50;

// Sistemin açılıp/kapanması için butonun en az 2 saniye basılı tutulması gerekir.
const unsigned long longPressDuration = 2000;

// =======================================================
// Edge Impulse Ham Ses Verisi Alma Fonksiyonu
// =======================================================
// Edge Impulse sınıflandırıcı bu fonksiyon üzerinden audio_buffer içindeki
// ham ses verilerini float formatında okur.
int raw_feature_get_data(size_t offset, size_t length, float *out_ptr) {
  for (size_t i = 0; i < length; i++) {
    out_ptr[i] = (float)audio_buffer[offset + i];
  }

  return 0;
}

// =======================================================
// Buton Kesme Servis Rutini / Interrupt Service Routine
// =======================================================
// FALLING kenarında çalışır. INPUT_PULLUP kullanıldığı için butona basılınca
// pin HIGH durumundan LOW durumuna düşer ve kesme tetiklenir.
void IRAM_ATTR buttonISR() {
  buttonInterruptFlag = true;
}

void setup() {
  // Seri haberleşme başlatılır.
  // ESP32'nin tahmin sonuçları ve debug mesajları Serial Monitor'de görülür.
  Serial.begin(115200);
  delay(2000);

  // Buton dahili pull-up direnciyle kullanılır.
  // Butona basılmadığında HIGH, basıldığında LOW okunur.
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Gerçek donanımsal interrupt burada bağlanır.
  // Butona basıldığında GPIO4 HIGH -> LOW geçişi yapar ve buttonISR çalışır.
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), buttonISR, FALLING);

  // Dahili RGB LED çıkış olarak ayarlanır.
  pinMode(RGB_LED_PIN, OUTPUT);

  Serial.println();
  Serial.println("ESP32 Voice Control sistemi basladi");

  // I2S mikrofon yapılandırması yapılır.
  setupI2S();

  // Modelin beklediği ses örnek sayısı ve örnekleme frekansı ekrana yazdırılır.
  Serial.print("Model sample count: ");
  Serial.println(EI_CLASSIFIER_RAW_SAMPLE_COUNT);

  Serial.print("Model frequency: ");
  Serial.println(EI_CLASSIFIER_FREQUENCY);

  // Sistem başlangıçta açık olduğu için RGB LED durumu güncellenir.
  updateRgbLed();

  Serial.println("Sistem hazir.");
}

void loop() {
  // Her döngüde buton kontrol edilir.
  // Böylece kullanıcı sistemi açıp kapatabilir.
  checkButton();

  // Sistem kapalıysa ses kaydı ve sınıflandırma yapılmaz.
  if (!systemEnabled) {
    delay(200);
    return;
  }

  // Mikrofon üzerinden modelin istediği uzunlukta ses kaydı alınır.
  bool ok = recordAudio();

  // Ses kaydı başarısız olursa sınıflandırma yapılmaz.
  if (!ok) {
    Serial.println("DEBUG Ses kaydi alinamadi");
    delay(500);
    return;
  }

  // Edge Impulse için signal yapısı hazırlanır.
  // signal.total_length modelin beklediği örnek sayısını belirtir.
  // signal.get_data ise verinin nereden okunacağını gösterir.
  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data = &raw_feature_get_data;

  // Model tahmin sonuçlarının tutulacağı değişken
  ei_impulse_result_t result = { 0 };

  // Edge Impulse sınıflandırıcısı çalıştırılır.
  // false parametresi debug çıktılarının kapalı olduğunu belirtir.
  EI_IMPULSE_ERROR res = run_classifier(&signal, &result, false);

  // Sınıflandırma sırasında hata oluşursa döngü sonlandırılır.
  if (res != EI_IMPULSE_OK) {
    Serial.print("DEBUG Classifier hatasi: ");
    Serial.println(res);
    return;
  }

  // Model sonucu yorumlanır ve gerekiyorsa komut gönderilir.
  processResult(result);
}

void setupI2S() {
  // ESP32 I2S kanal ayarı yapılır.
  // ESP32 master olarak çalışır ve mikrofon verisini alır.
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);

  // I2S RX kanalı oluşturulur.
  esp_err_t err = i2s_new_channel(&chan_cfg, NULL, &rx_handle);

  // Kanal oluşturulamazsa sistem durdurulur.
  if (err != ESP_OK) {
    Serial.println("I2S kanal olusturma hatasi");
    while (true) {}
  }

  // I2S standart mod yapılandırması yapılır.
  i2s_std_config_t std_cfg = {
    // Edge Impulse modelinin eğitimde kullandığı frekans ile aynı örnekleme frekansı seçilir.
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(EI_CLASSIFIER_FREQUENCY),

    // INMP441 mikrofon 32-bit veri üretir.
    // Stereo slot kullanılıp dolu kanal daha sonra yazılımda seçilir.
    .slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO),

    // I2S pin bağlantıları burada tanımlanır.
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = (gpio_num_t)I2S_BCLK,
      .ws   = (gpio_num_t)I2S_WS,
      .dout = I2S_GPIO_UNUSED,
      .din  = (gpio_num_t)I2S_DIN,
      .invert_flags = {
        .mclk_inv = false,
        .bclk_inv = false,
        .ws_inv = false,
      },
    },
  };

  // I2S kanalı standart modda başlatılır.
  err = i2s_channel_init_std_mode(rx_handle, &std_cfg);

  // Başlatma hatası varsa sistem durdurulur.
  if (err != ESP_OK) {
    Serial.println("I2S init hatasi");
    while (true) {}
  }

  // I2S kanalı aktif edilir ve mikrofon verisi okunabilir hale gelir.
  err = i2s_channel_enable(rx_handle);

  // Kanal aktif edilemezse sistem durdurulur.
  if (err != ESP_OK) {
    Serial.println("I2S enable hatasi");
    while (true) {}
  }
}

bool recordAudio() {
  Serial.println("DEBUG 2 saniyelik ses aliniyor...");

  // Toplanan örnek sayısını tutar.
  int samplesCollected = 0;

  // Modelin istediği örnek sayısına ulaşana kadar mikrofon verisi okunur.
  while (samplesCollected < EI_CLASSIFIER_RAW_SAMPLE_COUNT) {
    // Kayıt sırasında da buton kontrol edilir.
    // Böylece kullanıcı ses kaydı devam ederken sistemi kapatabilir.
    checkButton();

    // Sistem kayıt sırasında kapatılırsa kayıt iptal edilir.
    if (!systemEnabled) {
      Serial.println("DEBUG Kayit sirasinda mikrofon kapatildi");
      return false;
    }

    // I2S mikrofon 32-bit ham veri verdiği için geçici buffer int32_t olarak tanımlanır.
    int32_t rawSamples[512];

    // Okunan byte sayısı burada tutulur.
    size_t bytesRead = 0;

    // Mikrofon verisi I2S üzerinden okunur.
    esp_err_t result = i2s_channel_read(
      rx_handle,
      rawSamples,
      sizeof(rawSamples),
      &bytesRead,
      1000
    );

    // Okuma hatası varsa veya hiç veri gelmediyse kayıt başarısız kabul edilir.
    if (result != ESP_OK || bytesRead == 0) {
      return false;
    }

    // Okunan 32-bit örnek sayısı hesaplanır.
    int rawCount = bytesRead / sizeof(int32_t);

    // INMP441 stereo formatta veri gönderiyor gibi okunabilir.
    // Genellikle veriler Left, Right, Left, Right şeklinde sıralanır.
    // L/R pini GND bağlıysa çoğunlukla sol kanal dolu olur.
    // Bu yüzden 0, 2, 4... indeksleri alınır.
    for (int i = 0; i + 1 < rawCount && samplesCollected < EI_CLASSIFIER_RAW_SAMPLE_COUNT; i += 2) {
      // 32-bit mikrofon verisi 16-bit aralığa yaklaştırılır.
      int32_t sample = rawSamples[i] >> 14;

      // Taşma olmaması için örnek değeri int16_t sınırlarına sıkıştırılır.
      if (sample > 32767) sample = 32767;
      if (sample < -32768) sample = -32768;

      // İşlenmiş ses örneği Edge Impulse bufferına kaydedilir.
      audio_buffer[samplesCollected++] = (int16_t)sample;
    }
  }

  // Gerekli miktarda ses örneği başarıyla toplandı.
  return true;
}

void processResult(ei_impulse_result_t result) {
  // En yüksek skora sahip sınıf
  const char* bestLabel = "";
  float bestScore = 0.0;

  // İkinci en yüksek skora sahip sınıf
  const char* secondLabel = "";
  float secondScore = 0.0;

  Serial.println("----- Tahmin Sonuclari -----");

  // Modelin tüm sınıf sonuçları tek tek gezilir.
  for (size_t ix = 0; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
    const char* label = result.classification[ix].label;
    float score = result.classification[ix].value;

    // Her sınıfın tahmin skoru Serial Monitor'e yazdırılır.
    Serial.print(label);
    Serial.print(": ");
    Serial.print(score, 3);
    Serial.print(" | ");

    // En yüksek ve ikinci en yüksek skorlar belirlenir.
    if (score > bestScore) {
      secondScore = bestScore;
      secondLabel = bestLabel;

      bestScore = score;
      bestLabel = label;
    }
    else if (score > secondScore) {
      secondScore = score;
      secondLabel = label;
    }
  }

  Serial.println();

  // En iyi sınıf ile ikinci sınıf arasındaki skor farkı hesaplanır.
  float margin = bestScore - secondScore;

  // Debug amacıyla en iyi sınıf, ikinci sınıf ve skor farkı yazdırılır.
  Serial.print("DEBUG En iyi sinif: ");
  Serial.print(bestLabel);
  Serial.print(" skor=");
  Serial.print(bestScore, 3);
  Serial.print(" ikinci=");
  Serial.print(secondLabel);
  Serial.print(" ikinciSkor=");
  Serial.print(secondScore, 3);
  Serial.print(" margin=");
  Serial.println(margin, 3);

  // Ortam sesi veya komut dışı konuşma algılanırsa herhangi bir işlem yapılmaz.
  if (
    strcmp(bestLabel, "ortam") == 0 ||
    strcmp(bestLabel, "diger_konusma") == 0
  ) {
    resetPending();
    Serial.println("DEBUG Komut disi ses algilandi, islem yok");
    return;
  }

  // Tahmin skoru yeterince yüksek değilse komut geçersiz sayılır.
  if (bestScore < CONFIDENCE_THRESHOLD) {
    resetPending();
    Serial.println("DEBUG Guven dusuk, komut yok");
    return;
  }

  // En iyi sınıf ile ikinci sınıf birbirine yakınsa model kararsız kabul edilir.
  if (margin < MARGIN_THRESHOLD) {
    resetPending();
    Serial.println("DEBUG Siniflar birbirine yakin, komut yok");
    return;
  }

  // Aynı komut üst üste geldiyse sayaç artırılır.
  // Farklı komut geldiyse yeni komut beklemeye alınır.
  if (pendingLabel == String(bestLabel)) {
    pendingCount++;
  }
  else {
    pendingLabel = String(bestLabel);
    pendingCount = 1;
  }

  Serial.print("DEBUG pending=");
  Serial.print(pendingLabel);
  Serial.print(" count=");
  Serial.println(pendingCount);

  // Komut gerekli tekrar sayısına ulaştıysa ilgili işlem yapılır.
  if (pendingCount >= REQUIRED_REPEAT) {
    sendCommandForLabel(bestLabel);
    resetPending();
  }
}

void sendCommandForLabel(const char* label) {
  // Geçerli zaman alınır.
  unsigned long now = millis();

  // Son komuttan sonra yeterli süre geçmediyse yeni komut gönderilmez.
  // Bu yapı yazılımsal zamanlayıcı mantığıyla çalışır.
  if (now - lastCommandTime < commandCooldown) {
    Serial.println("DEBUG Cooldown aktif, komut gonderilmedi");
    return;
  }

  // Algılanan sınıfa göre seri port üzerinden komut gönderilir.
  // Bilgisayar tarafındaki uygulama bu çıktıları okuyarak ses kontrolü yapabilir.
  if (strcmp(label, "sesi_dusur") == 0) {
    Serial.println("VOLUME_DOWN");
    lastCommandTime = now;
  }
  else if (strcmp(label, "sesi_yukselt") == 0) {
    Serial.println("VOLUME_UP");
    lastCommandTime = now;
  }
  else if (strcmp(label, "sesi_kapat") == 0) {
    Serial.println("MUTE");
    lastCommandTime = now;
  }
  else if (strcmp(label, "sonraki_muzik") == 0) {
    Serial.println("NEXT");
    lastCommandTime = now;
  }
  else {
    // Modelden beklenmeyen bir sınıf gelirse işlem yapılmaz.
    Serial.println("DEBUG Bilinmeyen sinif, komut yok");
  }
}

void resetPending() {
  // Bekleyen komut bilgileri sıfırlanır.
  // Böylece yanlış veya kararsız algılamalar sonrası sistem temiz duruma geçer.
  pendingLabel = "";
  pendingCount = 0;
}

void updateRgbLed() {
  // Sistem aktifken RGB LED yeşil yanar.
  // Bu durum mikrofonun açık olduğunu gösterir.
  if (systemEnabled) {
    neopixelWrite(RGB_LED_PIN, 0, 20, 0);
  }
  else {
    // Sistem kapalıyken RGB LED söner.
    // Bu durum mikrofonun kapalı olduğunu gösterir.
    neopixelWrite(RGB_LED_PIN, 0, 0, 0);
  }
}

void checkButton() {
  // Bu fonksiyon butonu sürekli polling ile sorgulamaz.
  // Sadece ISR tarafından buttonInterruptFlag true yapıldıysa işlem yapar.
  if (!buttonInterruptFlag) {
    return;
  }

  // ISR ile ana kod arasında paylaşılan bayrak kısa süreliğine güvenli şekilde temizlenir.
  noInterrupts();
  buttonInterruptFlag = false;
  interrupts();

  unsigned long now = millis();

  // Debounce: Son geçerli buton kesmesinden sonra 50 ms geçmediyse bu tetikleme yok sayılır.
  if (now - lastButtonInterruptTime < debounceDelay) {
    return;
  }

  // INPUT_PULLUP kullanıldığı için gerçek basma durumunda pin LOW okunur.
  // Yanlış tetikleme varsa işlem yapılmaz.
  if (digitalRead(BUTTON_PIN) != LOW) {
    return;
  }

  unsigned long pressStartTime = now;
  Serial.println("DEBUG Buton algilandi, sistemi degistirmek icin 2 saniye basili tutun");

  // Interrupt sadece basma anını yakalar. 2 saniye basılı tutma kontrolü ana kodda yapılır.
  while (digitalRead(BUTTON_PIN) == LOW) {
    if (millis() - pressStartTime >= longPressDuration) {
      // Buton 2 saniye boyunca basılı kaldıysa sistem açık/kapalı durumu değiştirilir.
      systemEnabled = !systemEnabled;
      lastButtonInterruptTime = millis();

      // Sistem durumu değiştiği için bekleyen komutlar temizlenir.
      resetPending();

      // RGB LED yeni sistem durumuna göre güncellenir.
      updateRgbLed();

      if (systemEnabled) {
        Serial.println("DEBUG Mikrofon ACILDI");
      }
      else {
        Serial.println("DEBUG Mikrofon KAPATILDI");
      }

      // Kullanıcı butonu bırakana kadar beklenir.
      // Böylece aynı uzun basış ikinci kez işlem üretmez.
      while (digitalRead(BUTTON_PIN) == LOW) {
        delay(10);
      }

      lastButtonInterruptTime = millis();
      return;
    }

    delay(10);
  }

  // Buton 2 saniye dolmadan bırakılırsa sistem durumu değişmez.
  lastButtonInterruptTime = millis();
  Serial.println("DEBUG Buton 2 saniye dolmadan birakildi, sistem degismedi");
}
