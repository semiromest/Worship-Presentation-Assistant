// Bridge-side messages use the renderer's own in-app dialogs (no native popups).
type Key = 'popupBlocked' | 'screensReady' | 'driveNotConfigured' | 'pptxImport' | 'saveFailed' | 'openFailed' | 'missingMedia' | 'unsaved' | 'unsupported';

const COPY: Record<'tr' | 'en', Record<Key, { title: string; message: string }>> = {
  tr: {
    popupBlocked: { title: 'Yayın penceresi açılamadı', message: 'Tarayıcı açılır pencereyi engelledi. Adres çubuğundaki simgeden bu site için açılır pencerelere izin verip tekrar deneyin.' },
    screensReady: { title: 'Ekranlar algılandı', message: 'Bilgisayara bağlı ekranlar artık kullanılabilir. Yayını ikinci ekranda açmak için Yayını Başlat\'a yeniden tıklayın.' },
    driveNotConfigured: { title: 'Google Drive henüz ayarlanmadı', message: 'Bu web sürümü için Google Drive bağlantısı yapılandırılmamış. Sunumlarınızı şimdilik dosya olarak kaydedip açabilirsiniz.' },
    pptxImport: { title: 'PowerPoint içe aktarma', message: 'PowerPoint dosyalarını içe aktarmak şimdilik yalnızca masaüstü uygulamasında kullanılabiliyor. PowerPoint\'e dışa aktarma web sürümünde de çalışır.' },
    saveFailed: { title: 'Kaydedilemedi', message: 'Sunum dosyası oluşturulamadı.' },
    openFailed: { title: 'Açılamadı', message: 'Dosya geçerli bir .gpres sunumu değil ya da bozuk.' },
    missingMedia: { title: 'Eksik medya', message: 'Bazı medya dosyaları bu tarayıcıda bulunamadı. Bunları yeniden ekleyip tekrar kaydedin:' },
    unsaved: { title: 'Kaydedilmemiş değişiklikler', message: 'Mevcut sunumdaki kaydedilmemiş değişiklikler kaybolacak.' },
    unsupported: { title: 'Web sürümünde yok', message: 'Bu özellik şimdilik yalnızca masaüstü uygulamasında kullanılabiliyor.' },
  },
  en: {
    popupBlocked: { title: 'Could not open the output window', message: 'The browser blocked the popup. Allow popups for this site from the address bar and try again.' },
    screensReady: { title: 'Screens detected', message: 'The screens connected to this computer are now available. Click Start Broadcast again to open the output on the second screen.' },
    driveNotConfigured: { title: 'Google Drive is not set up yet', message: 'Google Drive has not been configured for this web version. For now, save and open your presentations as files.' },
    pptxImport: { title: 'PowerPoint import', message: 'Importing PowerPoint files is currently available only in the desktop app. Exporting to PowerPoint works on the web too.' },
    saveFailed: { title: 'Could not save', message: 'The presentation file could not be created.' },
    openFailed: { title: 'Could not open', message: 'The file is not a valid .gpres presentation or it is damaged.' },
    missingMedia: { title: 'Missing media', message: 'Some media files are not available in this browser. Add them again, then save:' },
    unsaved: { title: 'Unsaved changes', message: 'Unsaved changes in the current presentation will be lost.' },
    unsupported: { title: 'Not available on the web', message: 'This feature is currently available only in the desktop app.' },
  },
};

async function language(): Promise<'tr' | 'en'> {
  const { default: i18n } = await import('../../src/renderer/i18n');
  return i18n.language?.startsWith('tr') ? 'tr' : 'en';
}

export async function notify(key: Key, detail?: string): Promise<void> {
  const copy = COPY[await language()][key];
  const { alertDialog } = await import('../../src/renderer/dialogs');
  await alertDialog(copy.message, { title: copy.title, detail });
}

export async function confirmKey(key: Key, confirmLabel?: string, cancelLabel?: string): Promise<boolean> {
  const copy = COPY[await language()][key];
  const { confirmDialog } = await import('../../src/renderer/dialogs');
  return confirmDialog(copy.message, { title: copy.title, confirmLabel, cancelLabel });
}

export async function confirmNative(options: { message: string; title?: string; detail?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  const { confirmDialog } = await import('../../src/renderer/dialogs');
  return confirmDialog(options.message, options);
}

export async function alertNative(options: { message: string; title?: string; detail?: string; okLabel?: string }): Promise<void> {
  const { alertDialog } = await import('../../src/renderer/dialogs');
  await alertDialog(options.message, options);
}
