import type { DesktopAPI } from './shared/model';
declare global { interface Window { sakli?: DesktopAPI } }
export function getAPI(): DesktopAPI { if (!window.sakli) throw new Error('DubBitig masaüstü uygulamasından açılmalı. Başlatmak için npm start komutunu kullan.'); return window.sakli; }
