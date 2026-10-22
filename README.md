# LGS 470+ paneli

Tek konteyner: Node sunucusu hem sayfayı (`public/`) sunar hem de kayıt API'sini çalıştırır. Veriler SQLite dosyasında (`/data/lgs.db`) tutulur.

## Coolify ayarları
- **Persistent Storage**: konteyner yolu `/data` (bu olmadan her deploy'da veriler silinir)
- **Environment**: `APP_TOKEN` = uygulamada girilecek senkron kodu (uzun, tahmin edilemez bir değer)
- Port: `80` (değişmedi)

## API
- `GET /api/health` → `{ ok, token }`
- `GET /api/state` → `{ json, v, updated }` (Bearer APP_TOKEN)
- `PUT /api/state` `{ json, base }` → `{ v }`; sunucudaki sürüm `base`'den yeniyse `409`
- `GET /api/history` → son 50 kayıt sürümü; `GET /api/history?v=12` → o sürümün içeriği

Her kayıt `history` tablosuna da yazılır (son 300 sürüm tutulur).

## Yedek
```sh
docker exec <konteyner> node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync("/data/lgs.db").exec("VACUUM INTO \"/data/yedek.db\"")'
```

## Sayfayı güncelleme
`./build.sh kaynak.html` → `public/index.html`
