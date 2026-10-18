# DubBitig Firefox eklentisi

Seçili metni, komutu veya bağlantıyı sağ tık menüsünden yerel DubBitig arşivine kaydeder. Masaüstü DubBitig kurulu olmalıdır; kurulum Firefox ile yerel bağlantıyı (native messaging) kendisi kaydeder.

## Yükleme

- **Geçici (her Firefox sürümü):** `about:debugging#/runtime/this-firefox` → **Geçici eklenti yükle** → bu klasördeki `manifest.json`. Firefox kapanınca kaldırılır.
- **Kalıcı:** Firefox kararlı sürümü yalnızca Mozilla tarafından imzalanmış eklentileri kalıcı kurar. Eklentiyi addons.mozilla.org üzerinden (liste dışı da olabilir) imzalatıp oluşan `.xpi` dosyasını Firefox'a sürükleyin. Firefox Developer Edition / Nightly'de `xpinstall.signatures.required` ayarı kapatılarak imzasız kurulabilir.

Eklenti kimliği: `dubbitig@nergal-exe.github.io`. Komutlar saklanır, çalıştırılmaz.
