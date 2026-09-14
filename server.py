import http.server
import socket
import socketserver
import sys

# 1. Автоматический поиск свободного порта
def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0)) # Передача 0 заставляет ОС выделить случайный свободный порт
        return s.getsockname()[1]

PORT = get_free_port()
Handler = http.server.SimpleHTTPRequestHandler

# 2. Настройка повторного использования порта (чтобы он сразу освобождался при закрытии)
class MyTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

# 3. Запуск сервера только на localhost
try:
    with MyTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"\n[ СЕРВЕР ЗАПУЩЕН ]")
        print(f"Адрес: http://localhost:{PORT}")
        print(f"Корневая папка: текущая директория")
        print("Для остановки нажмите: CTRL + C\n")
        
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n[ СЕРВЕР ОСТАНОВЛЕН ] Порт успешно освобожден.")
    sys.exit(0)
