"""[Fix, найдено этой сессией] python -m http.server (см. .claude/launch.json)
не отправляет НИКАКИХ cache-control заголовков — браузер на голой
эвристике (Chrome, без Expires/Cache-Control, кэширует статику на процент
от "давности" Last-Modified) начинает отдавать файл из диска БЕЗ единого
сетевого запроса уже через секунды после правки, даже на чистой вкладке
без единого байта предыдущего JS-состояния (проверено: fetch(...,{cache:
"reload"}) в открытой вкладке видел актуальный файл, а обычная навигация
в ТОЙ ЖЕ вкладке — нет). За время этой сессии это как минимум дважды
маскировалось под "правка не подействовала" (один раз — реальный баг,
один раз — ложная тревога). Единственная разница с http.server —
Cache-Control: no-store на каждом ответе; остаётся тем же простым
однофайловым сервером без внешних зависимостей, тот же usage
(python dev-server.py [port]).
"""
import functools
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# [Fix РЕАЛЬНЫЙ БАГ, найдено независимым ревью, воспроизведено живьём]
# SimpleHTTPRequestHandler без явного directory= берёт os.getcwd() —
# ПЕРЕЧИТЫВАЯ его на КАЖДЫЙ запрос (translate_path), не один раз при
# старте. Раньше здесь не было ROOT_DIR, и работало это только благодаря
# случайному совпадению: .claude/launch.json запускает
# `python dev-server.py <port>` с cwd, который сам харнесс всегда ставит
# в корень проекта. Ничто в самом dev-server.py этого не гарантировало —
# если бы запуск когда-нибудь пошёл из другого cwd, сервер молча отдавал
# бы чужую директорию (или сплошные 404) без единой ошибки в логе.
# Воспроизведено: запуск из посторонней папки отдавал ЕЁ листинг вместо
# корня pc_lite. ROOT_DIR, вычисленный от расположения ЭТОГО файла (тот
# же приём, что server_start.bat уже применял через %~dp0 к server.py),
# убирает зависимость от того, кто и откуда вызвал интерпретатор.
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    # [Fix] plain HTTPServer однопоточен — одно зависшее/долгое соединение
    # (например keep-alive от предыдущего запроса) блокирует ВСЕ следующие
    # запросы, включая саму навигацию браузера (обнаружено сразу же: первая
    # попытка с plain HTTPServer живьём подвесила навигацию на 300с).
    # python -m http.server сам по себе с Python 3.7+ использует
    # ThreadingHTTPServer по умолчанию — здесь то же самое, не понижение.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4351
    oHandler = functools.partial(NoCacheHandler, directory=ROOT_DIR)
    ThreadingHTTPServer(("", port), oHandler).serve_forever()
