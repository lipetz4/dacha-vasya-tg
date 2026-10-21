# CREDITS — «Дача Мурлыки Васи» (game4)

## Аудио (вендорено в `assets/audio/`, перекодировано в MP3, обрезано/нормализовано)
| Файл | Источник | Автор | Лицензия |
|---|---|---|---|
| meow1–meow4.mp3 | [Meow of a pleading cat.oga](https://commons.wikimedia.org/wiki/File:Meow_of_a_pleading_cat.oga) (Wikimedia Commons) | Heismark | Public domain |
| meow5.mp3 | [Maullido de gata hembra joven.ogg](https://commons.wikimedia.org/wiki/File:Maullido_de_gata_hembra_joven.ogg) (Wikimedia Commons) | George Miquilena | CC0 1.0 |
| purr1.mp3 | [Purr (10 sec loopable).ogg](https://commons.wikimedia.org/wiki/File:Purr_(10_sec_loopable).ogg) (Wikimedia Commons) | см. страницу файла | Public domain |
| purr2.mp3 | [Purring cat.oga](https://commons.wikimedia.org/wiki/File:Purring_cat.oga) (Wikimedia Commons) | см. страницу файла | Public domain |
| scratch.mp3 | синтезирован (ffmpeg, фильтрованный шум) | собственная генерация | CC0 / без ограничений |
| music_dacha.ogg / music_dacha.mp3 | «Дачный вальсок» — 80 с, бесшовный луп, 96 BPM, C-dur (укулеле Karplus-Strong, маримба, бас, шейкер); сгенерирован программно `tools/compose_music.py` | собственная генерация | без ограничений |

Атрибуция для PD/CC0 не обязательна, но приводится для прозрачности. Перед релизом стоит перепроверить страницы источников.

## Графика
- Арт Васи, предметов, UI, ивентов, соседей, карты — пак Лины (внутренний, ASSETS_NEEDED.md).
- Пак Лины v5 (`assets/v5/`, вырезано rembg + чистка ореолов, `tools/cut_lina_pack_v5.py`): позы Васи без шляпы (nh_*), шаг walk1/walk2, scratch_pose, purr_pose, 16 предметов гардероба, декор (гном, клумба, скамейка, пугало, качели), 8 находок альбома, кнопки HUD.
- ic_music / ic_music_off — собраны из кнопки Лины (ic_settings) с нарисованной нотой.
- Ворона (crow) и сердечки — процедурная графика в коде (`features6.js`).
- Шрифт Nunito — SIL Open Font License 1.1.
- Phaser 3.90 — MIT.
