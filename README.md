# Finansal Risk & Portföy Analiz Platformu

Kullanıcının hisse/ETF/kripto gibi varlıklar için gerçek fiyat verisini
inceleyebildiği, risk/getiri/teknik metrikleri görebildiği, ağırlıklı bir
portföy kurup performansını (endeks karşılaştırması, korelasyon, optimizasyon,
stres testi dahil) analiz edebildiği ve gerçek alım işlemlerini takip
edebildiği tam kapsamlı bir web uygulaması.

Varsayılan olarak 5 BIST hissesiyle (THYAO, ASELS, GARAN, TUPRS, AKBNK) gelir
ama bununla sınırlı değildir — arama çubuğuyla Yahoo Finance'teki hemen hemen
her hisse/ETF/kripto para aranıp tek tıkla izleme listesine eklenebilir.
Arayüz, profesyonel bir finans terminali hissi veren, koyu/açık tema
seçenekli bir tasarıma (IBM Plex Sans/Mono tipografisi, altın vurgu rengi)
sahiptir.

## İçindekiler

- [Özellikler](#özellikler)
- [Kullanılan Teknolojiler](#kullanılan-teknolojiler)
- [Mimari](#mimari)
- [Kurulum](#kurulum)
- [Çalıştırma](#çalıştırma)
- [Ortam Değişkenleri](#ortam-değişkenleri)
- [Testler](#testler)
- [Veritabanı Yapısı](#veritabanı-yapısı)
- [Kullanılan Finansal Metrikler](#kullanılan-finansal-metrikler)

## Özellikler

**Varlık takibi & piyasa verisi**
- Yahoo Finance üzerinden global sembol arama (Ctrl+K) ve tek tıkla izleme
  listesine ekleme — eklenen varlık anında ~1 yıllık gerçek fiyat geçmişiyle
  birlikte her sayfada görünür hale gelir.
- **Piyasa Görünümü**: canlı kart/tablo görünümü, sıralama/filtreleme,
  çoklu-varlık normalize edilmiş performans karşılaştırma paneli.
- **Varlık Listesi & Detay Sayfası**: sıralanabilir karşılaştırma tablosu +
  her sembol için mum (candlestick) grafiği, teknik göstergeler (SMA 20/50/200,
  RSI(14), MACD), dönemsel getiri ızgarası ve temel analiz sekmesi (F/K,
  PD/DD, analist tavsiyeleri, kazanç takvimi, kurumsal ortaklar).
- **Canlı veri**: tek bir paylaşımlı WebSocket bağlantısı üzerinden fiyat,
  endeks, emtia, kripto, döviz ve haber güncellemeleri anlık olarak
  yayınlanır — istemciler kendi kendine polling yapmaz.
- **Sektör etiketleri**, **kripto kazanan/kaybeden listesi**, **küresel
  ekonomik gösterge haritası** (enflasyon / GSYH büyümesi / işsizlik, ülke
  bazında, döner 3D küre üzerinde).

**Portföy analizi**
- Ağırlıklı portföy oluşturma/düzenleme/silme, kaydırma çubuğuyla ağırlık
  ayarlama, tek tıkla eşit dağıtım.
- Portföy endeksi (baz=100), BIST 100 veya özel bir kıyas endeksiyle
  karşılaştırma; toplam getiri, volatilite, maksimum düşüş, Sharpe oranı.
- Varlık dağılımı donut grafiği, korelasyon matrisi, sektör/döviz kırılımı.
- **Portföy optimizasyonu**: Maksimum Sharpe, Minimum Varyans ve Risk
  Paritesi hedefleriyle önerilen ağırlıklar.
- **Rebalancing önerileri**, **senaryo/stres testi** (BIST 100'e göre beta ve
  varsayımsal düşüş senaryoları), **risk uyarıları** (yüksek volatilite,
  büyük düşüş, negatif Sharpe, yüksek korelasyon, RSI aşırı alım/satım vb.).
- Birden fazla portföyü aynı grafikte karşılaştırma.
- CSV/PDF rapor dışa aktarma, paylaşılabilir salt-okunur bağlantı
  (kimlik doğrulama gerektirmeyen genel görünüm).

**Pozisyon (holding) takibi**
- Gerçek alım işlemlerini (miktar, fiyat, tarih) portföylerden bağımsız veya
  bir portföye bağlı olarak kaydetme; güncel değer, maliyet ve
  gerçekleşmemiş/gerçekleşmiş kâr-zarar otomatik hesaplanır (FIFO).
- Karma para birimi desteği (gerçek döviz kuruyla TL'ye çevirerek
  birleştirme), CSV içe aktarma.
- **Temettü takvimi** (gerçek geçmiş temettü ödemeleri), **vergi raporu**
  (yıl/sembol bazında gerçekleşmiş kâr-zarar), **net değer geçmişi**
  (geçmişe dönük portföy değeri grafiği).

**Hesap & güvenlik**
- JWT tabanlı kimlik doğrulama, oturum yönetimi (aktif oturumları görme/tek
  tek veya toplu sonlandırma), TOTP tabanlı iki faktörlü doğrulama, işlem
  geçmişi (audit log), giriş denemesi kilitleme ve genel amaçlı rate
  limiting.
- Kullanıcı bazlı görüntüleme para birimi ve dil tercihi (Türkçe/İngilizce,
  i18next).
- Fiyat/risk uyarıları — dahili bildirim, e-posta ve tarayıcı push
  bildirimi (Web Push/VAPID) olarak; opsiyonel haftalık/aylık portföy özeti
  e-postası.

**Diğer**
- PWA desteği (kurulabilir uygulama kabuğu, hızlı tekrar açılış).
- Koyu (varsayılan) ve açık tema, tüm grafik/renklerle birlikte tema-uyumlu.
- Hata izleme (Sentry, opsiyonel), hata sınırı (ErrorBoundary) ile çökme
  yerine anlaşılır hata ekranı.

## Kullanılan Teknolojiler

**Backend**
- Python, FastAPI, WebSocket (canlı veri yayını)
- SQLAlchemy (ORM) + MS SQL Server (pyodbc), Alembic (migration'lar)
- JWT + TOTP tabanlı kimlik doğrulama (PyJWT, bcrypt, pyotp)
- pandas / numpy / scipy — getiri, volatilite, Sharpe, drawdown, portföy
  optimizasyonu hesaplamaları
- yfinance (Yahoo Finance) — gerçek hisse/ETF/kripto/döviz/emtia verisi
- World Bank açık veri API'si — ülke bazlı ekonomik göstergeler
- Opsiyonel: Redis (çok worker'lı dağıtımda WebSocket fanout + paylaşımlı
  önbellek), Sentry, SMTP (e-posta), Web Push (VAPID)
- pytest

**Frontend**
- React + TypeScript (Vite), react-router-dom
- Chart.js (react-chartjs-2) — çizgi/donut grafikler
- Canvas 2D (özel, kütüphanesiz) — mum grafiği
- d3-geo + topojson-client (özel, kütüphanesiz SVG) — dünya haritası/küre
- Tailwind CSS v4 + shadcn yapısı + framer-motion + lucide-react (Piyasa
  Görünümü sayfası); geri kalan sayfalarda elle yazılmış CSS
- i18next (Türkçe/İngilizce), vite-plugin-pwa
- Vitest (birim/komponent testleri), Playwright (uçtan uca testler)

## Mimari

```
backend/
  routers/     FastAPI route handler'ları (auth, assets, portfolios, holdings, markets, public, ws, ...)
  services/    İş mantığı ve veritabanı sorguları
  models/      SQLAlchemy ORM modelleri
  analysis/    Saf, veritabanından bağımsız finansal hesaplama fonksiyonları
  migrations/  Alembic migration'ları
frontend/
  src/pages/       Yönlendirilen sayfalar
  src/components/  Paylaşılan UI bileşenleri
  src/lib/         Saf istemci tarafı hesaplamalar, context'ler, yardımcılar
  src/charts/      Chart.js sarmalayıcıları ve elle yazılmış mum grafiği
database/
  schema.sql   Elle tutulan referans şema (gerçek şemanın kaynağı backend'dir)
```

Daha ayrıntılı mimari notlar için `CLAUDE.md` dosyasına bakın.

## Kurulum

### Ön koşullar

- Python 3.11+, Node.js 18+
- MS SQL Server (örn. SQLEXPRESS), ODBC Driver 17/18 for SQL Server

### Backend

```powershell
cd backend
python -m venv ../venv          # proje kökünde bir sanal ortam oluşturur
..\venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # gerekirse MSSQL/JWT ayarlarını düzenleyin
```

MS SQL Server çalışıyor olmalı ve `.env` içindeki `MSSQL_SERVER` değeri buna
işaret etmeli. Veritabanı ve tablolar backend ilk çalıştığında otomatik
oluşturulur; sonraki şema değişiklikleri için Alembic kullanılır:

```powershell
..\venv\Scripts\python.exe -m alembic upgrade head
```

### Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local    # gerekirse VITE_API_BASE_URL'i düzenleyin
```

## Çalıştırma

```powershell
# Backend (http://localhost:8000, Swagger: /docs)
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

# Örnek fiyat verisini yükle (tek seferlik / güncellemek için tekrar çalıştırılabilir)
..\venv\Scripts\python.exe -m data.seed_prices

# Frontend (http://localhost:5173 — "localhost" olarak açılmalı, 127.0.0.1 değil)
cd frontend
npm run dev
```

## Dağıtım (Deployment)

Frontend ve backend farklı türde iki platforma dağıtılır — backend WebSocket
bağlantıları ve arka planda sürekli çalışan görevler barındırdığı için
sunucusuz (serverless) bir platformda çalışamaz:

- **Frontend → Vercel**: repoyu Vercel'de import edip kök dizin olarak
  `frontend`'i seçmeniz yeterli (`frontend/vercel.json` SPA yönlendirmesini
  halleder). `VITE_API_BASE_URL` ortam değişkenini backend'in gerçek adresine
  ayarlayın.
- **Backend → Render**: repo kökündeki `render.yaml` bir Render Blueprint'i —
  Render'da "New → Blueprint" ile bu repoyu seçtiğinizde backend'i ve
  yönetilen ücretsiz bir PostgreSQL veritabanını otomatik kurar
  (`DATABASE_URL` aralarında otomatik bağlanır). Deploy sonrası backend'in
  `CORS_ORIGINS` ortam değişkenini gerçek Vercel adresinizle güncelleyin.

Yerel geliştirmede hâlâ MS SQL Server kullanılır; `DATABASE_URL` sadece
ayarlandığında devreye girer (bkz. `backend/.env.example`).

## Ortam Değişkenleri

Tüm değişkenler ve açıklamaları `backend/.env.example` ve
`frontend/.env.example` dosyalarında. Öne çıkanlar:

| Değişken | Zorunlu mu | Açıklama |
|---|---|---|
| `MSSQL_SERVER`, `MSSQL_DATABASE` | Evet (yerelde) | Veritabanı bağlantısı |
| `DATABASE_URL` | Hayır | Ayarlanırsa `MSSQL_*` yerine tam bir SQLAlchemy URL'i kullanılır (örn. Render'daki Postgres) |
| `JWT_SECRET_KEY` | Evet (üretimde) | Token imzalama anahtarı |
| `CORS_ORIGINS` | Hayır | İzin verilen frontend origin'leri |
| `REDIS_URL` | Hayır | Çok worker'lı dağıtımda WebSocket/önbellek paylaşımı |
| `SENTRY_DSN` | Hayır | Hata izleme |
| `SMTP_*` | Hayır | Uyarı/özet e-postaları |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Hayır | Tarayıcı push bildirimi |
| `VITE_API_BASE_URL` | Hayır | Frontend'in konuştuğu backend adresi |

## Testler

```powershell
# Backend
cd backend
..\venv\Scripts\python.exe -m pytest -q

# Frontend — birim/komponent testleri
cd frontend
npm test

# Frontend — uçtan uca (Playwright); backend VE `npm run dev` önceden çalışıyor olmalı
npm run test:e2e
```

## Veritabanı Yapısı

MS SQL Server üzerinde, SQLAlchemy modelleri ile tanımlanan başlıca tablolar:

| Tablo | Açıklama |
|---|---|
| `users` | Kullanıcı hesapları, 2FA ve tercih ayarları |
| `assets` | Analiz edilebilir varlıklar (ticker, `yahoo_symbol`, borsa, para birimi, sektör) |
| `price_history` | Her varlık için tarih bazlı OHLCV verisi (`asset_id` → `assets`) |
| `portfolios` | Kullanıcıya ait portföyler (`user_id` → `users`) |
| `portfolio_assets` | Bir portföydeki varlıklar ve ağırlıkları |
| `holdings` / `holding_sales` | Gerçek alım/satım işlemleri, gerçekleşmiş kâr-zarar |
| `watchlist_items` | Kullanıcı bazlı izleme listesi kayıtları |
| `price_alerts` | Fiyat/risk uyarı tanımları |
| `user_sessions` | Aktif oturumlar (JWT `jti` ile eşleşir) |
| `audit_log` | Hesap ve portföy işlemlerinin geçmişi |
| `push_subscriptions` | Tarayıcı push bildirimi abonelikleri |

Şemanın elle tutulan referans kopyası `database/schema.sql` içindedir; gerçek
şema backend her başladığında `Base.metadata.create_all()` ile
oluşturulur/güncellenir, şema değişiklikleri ise Alembic migration'ları ile
taşınır (`backend/migrations/`).

## Kullanılan Finansal Metrikler

- **Günlük getiri**: `(bugünkü fiyat / dünkü fiyat) - 1`
- **Ortalama getiri**: günlük getirilerin ortalaması
- **Volatilite**: günlük getirilerin standart sapmasının yıllıklandırılmış
  hali (`std × √252`)
- **Maksimum düşüş (Max Drawdown)**: fiyatın/portföy endeksinin o ana
  kadarki en yüksek noktasından gördüğü en büyük yüzdesel gerileme
- **Sharpe oranı**: ortalama getirinin volatiliteye bölünmesiyle elde
  edilen, alınan risk başına getiriyi ölçen gösterge; risksiz faiz oranı,
  para birimine göre elle belirlenmiş ve belgelenmiş bir yıllık varsayımdır
  (bkz. `backend/services/analysis_service.py`'deki `RISK_FREE_RATES`)
- **Beta**: portföyün kıyas endeksine göre göreli oynaklığı
- **Portföy endeksi**: her varlığın fiyatı kendi başlangıç değerine göre
  normalize edilip verilen ağırlıklarla toplanarak elde edilen, 100 baz
  puanından başlayan birleşik performans göstergesi
- **Portföy optimizasyonu**: Maksimum Sharpe / Minimum Varyans (SLSQP ile)
  ve Risk Paritesi (eşit risk katkısı) hedefleri
