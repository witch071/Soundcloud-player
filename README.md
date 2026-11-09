# SC Player — SoundCloud клиент для Windows 11

## Запуск
1. Установи Node.js LTS (https://nodejs.org)
2. Скачай Xray-windows-64.zip с https://github.com/XTLS/Xray-core/releases
   и распакуй содержимое (xray.exe, *.dat) в папку `xray/`
3. В папке проекта:
   npm install
   npm start
4. Меню «VPN / Прокси…» (Ctrl+,) -> вставь ключ -> «Подключить»

## Сборка установщика
   npm run dist      (результат в папке dist/)

## Заметки
- Ключ: подойдёт обычная ссылка подписки (https://…) или vless:// / trojan://.
  Зашифрованные happ://crypt… ссылки приложение прочитать не сможет —
  попроси у провайдера обычную ссылку подписки.
- Вход через Google в встроенном браузере может блокироваться;
  используй вход по email/паролю или Apple.
- Медиаклавиши (play/pause/next) работают через Chromium Media Session.
