// Telegram build settings. This file is copied to dist/tg/tg-config.js AS IS (not minified):
// you may edit it right on the hosting without rebuilding.
window.TG_CONFIG={
 bot:'dacha_vasya_bot',          // bot username without @, e.g. 'dacha_vasya_bot' (from BotFather /newbot)
 app:'play',        // Mini App short name (from BotFather /newapp) -> https://t.me/<bot>/<app>
 adsgram:{rewarded:'',interstitial:''}, // Adsgram blockId: rewarded e.g. '12345', interstitial e.g. 'int-12345'
 monetag:{zone:'',sdk:''}, // optional fallback: Monetag zone id + script URL exactly as in the Monetag dashboard snippet; empty = off
 api:'',            // game server (HTTPS) for Stars purchases; empty = shop hidden, game is free
 headerColor:'#2b4a1e',
};
