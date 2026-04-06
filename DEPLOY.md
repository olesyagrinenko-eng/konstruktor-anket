# Публикация в GitHub и деплой на Render

## Рекомендация по репозиторию

Удобнее завести **отдельный репозиторий**, в **корне** которого лежат только файлы из папки `konstruktor-anket` (без кириллицы в пути и без лишних проектов из общего Cursor). Так Render проще собирает и обновляет сервис.

Если оставляете монорепозиторий, в настройках Render укажите **Root Directory** на путь к этой папке (см. ниже).

---

## Часть 1. GitHub

### Вариант A: новый репозиторий только с конструктором

1. На GitHub: **New repository** → имя, например `konstruktor-anket`, без README (или с README — не важно).
2. Локально скопируйте содержимое папки `konstruktor-anket` в чистую директорию или выполните из родительской папки:

   ```bash
   cd /путь/к/konstruktor-anket
   git init
   git add .
   git commit -m "Initial commit: конструктор анкет Flask"
   git branch -M main
   git remote add origin https://github.com/ВАШ_ЛОГИН/konstruktor-anket.git
   git push -u origin main
   ```

### Вариант B: монорепозиторий (весь Cursor)

1. В корне монорепо добавьте в `.gitignore` то, что не нужно в облаке (логи, venv и т.д.).
2. Закоммитьте папку `тесты креативов подход/konstruktor-anket/` (или перенесите её в ASCII-путь, например `apps/konstruktor-anket`, и закоммитьте).
3. На Render в поле **Root Directory** укажите, например:  
   `тесты креативов подход/konstruktor-anket`  
   (если Render не примет кириллицу — используйте вариант A или переименуйте папку в репозитории.)

---

## Часть 2. Render

### Способ 1: Blueprint (если используете `render.yaml`)

1. Войдите на [render.com](https://render.com), привяжите GitHub.
2. **New** → **Blueprint** → выберите репозиторий.
3. Render подхватит `render.yaml` (имя сервиса, команды сборки и старта).
4. Подтвердите создание. После билда откройте выданный URL (`https://….onrender.com`).

### Способ 2: Web Service вручную (часто проще)

1. **New** → **Web Service** → подключите репозиторий.
2. Настройки:
   - **Runtime:** Python 3
   - **Root Directory:** оставьте пустым, если репозиторий = только конструктор; иначе путь к папке с `app.py`.
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:**  
     `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`  
     (то же, что в `Procfile`; Render подставит `$PORT` сам.)
3. **Instance type:** Free (или выше, если нужно).
4. **Advanced** → при желании задайте **PYTHON_VERSION** = `3.12.8` (или оставьте авто; версию дублирует `runtime.txt`).
5. **Create Web Service**. Дождитесь успешного deploy.

### Проверка

- Откройте корневой URL сервиса — должна открыться страница конструктора.
- Если 502: в логах Render смотрите ошибку запуска (часто неверный Root Directory или не найден `app.py`).

---

## Что уже подготовлено в проекте

| Файл | Назначение |
|------|------------|
| `requirements.txt` | Flask, python-docx, **gunicorn** |
| `Procfile` | Команда `web` для платформ вроде Render/Heroku |
| `runtime.txt` | Версия Python для Render |
| `render.yaml` | Опциональный Blueprint |
| `app.py` | Слушает `0.0.0.0` и порт из переменной **`PORT`** |

Локально по-прежнему: `python app.py` → порт по умолчанию **5050**. Для отладки можно задать `FLASK_DEBUG=1`.

---

## Обновления после деплоя

После `git push` в ветку, которую Render отслеживает (обычно `main`), сервис пересоберётся автоматически (если включён auto-deploy).

---

## Ограничения Free tier на Render

- Сервис «засыпает» после простоя; первый заход после паузы может занять десятки секунд.
- Для внутреннего постоянного использования рассмотрите платный план или другой хостинг.

---

## Краткий чеклист

- [ ] Репозиторий с `app.py`, `requirements.txt`, `Procfile` в корне (или верный Root Directory на Render).
- [ ] `pip install` проходит без ошибок.
- [ ] Start command — **gunicorn**, не `python app.py`.
- [ ] После деплоя главная страница открывается по HTTPS.

Если нужно, могу отдельно добавить в репозиторий `.env.example` с описанием переменных (сейчас приложению достаточно стандартного `PORT` от Render).
