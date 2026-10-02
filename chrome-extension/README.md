# DubBitig Chrome eklentisi

Önce güncel DubBitig Setup dosyasını kurun. Setup, yerel iletişim bileşenini otomatik kaydeder. Eklenti yalnızca kullanıcı kayıt istediğinde seçili metni veya bağlantıyı yerel DubBitig arşivine aktarır; komut çalıştırmaz, sayfalardaki içerikleri sürekli izlemez.

1. DubBitig → **Windows ve Chrome → Chrome eklentisi klasörünü aç**.
2. Chrome’da `chrome://extensions` adresini açın, **Geliştirici modu**nu etkinleştirin.
3. **Paketlenmemiş öğe yükle** ile açılan `chrome-extension` klasörünü seçin. ZIP kullanıyorsanız önce kalıcı bir klasöre çıkarın.
4. Bağlantıya veya seçili metne sağ tıklayın → **DubBitig’e kaydet**. Komut, not ve bağlantı seçeneklerinden uygun olanı seçin. Araç çubuğundaki eklenti düğmesi mevcut sayfayı kaydeder.

Başarı veya hata eklenti simgesinde, Windows bildiriminde ve eklenti penceresinde görünür. DubBitig kapalıysa açılır. Kaydedilenler **hızlı kayıt** etiketiyle Kategorisiz bölümündedir. Chrome’un kendi ayar sayfaları gibi özel sayfalar HTTP/HTTPS bağlantısı olarak kaydedilemez.

## İzinler

- `contextMenus`: sağ tık seçenekleri.
- `nativeMessaging`: sadece `com.dubbitig.capture` yerel uygulamasıyla iletişim.
- `activeTab`: kullanıcı işlem yaptığında o sayfanın başlık/adresi.
- `notifications`: kayıt sonucunu gösterme.
- `storage`: yalnızca son işlem durumunu saklama.

Sunucuya veri gönderilmez. DubBitig bağlantı önizlemesi ve erişilebilirlik kontrolü için kaydedilen web sitesine istek yapabilir. Seçili komutlar yürütülmez. Kaynak sayfa adresi kayda eklenebilir.

## Mağazada yayımlama

Windows Chrome, yerel CRX dosyasının sessiz kurulmasına izin vermez. Bu sürüm geliştirme moduyla yüklenir. Kullanıcının Chrome Web Store geliştirici hesabında yayımlanması ayrıca gerekir; bu proje mağazada yayımlanmış değildir.

Mağaza yayını hazır olduğunda mağazanın public key değerini manifest.json içindeki key alanına koyun. `DUBBITIG_CHROME_STORE_ID` ortam değişkenini mağaza kimliğiyle ayarlayıp `npm.cmd run dist` çalıştırın. Derleme, native host iznini aynı kimlikle oluşturur ve Setup’a Chrome’un resmi mağaza kurulum bildirimini tetikleyen kayıt girdisini ekler. Chrome kullanıcıdan etkinleştirme izni isteyebilir; tarayıcı politikaları aşılmaz.

Referans: https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions

Mağaza kimliğiyle oluşturulan Setup, Chrome'un resmi HKLM kayıt yöntemi nedeniyle tüm kullanıcılar için kurulur ve yönetici izni ister. Mağaza kimliği olmayan normal paket kullanıcı hesabına kurulur, yönetici izni istemez.
