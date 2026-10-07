/* IMRS Data Hub — Nowcast section: GDP nowcast, model accuracy, model lab, report builder.
 *
 * Loaded on demand by index.html (window.HUB exposes the page's helpers). Data:
 *   data/nowcast.json        results of the fortnightly Python run (uzdata/nowcast/run.py)
 *   data/nowcast_panel.json  the transformed monthly panel and quarterly GDP target
 *   lib/econ.js              in-browser econometrics (reproduces the Python engine)
 * Models in the lab run in the viewer's browser (no AI credits). Claude is used only
 * when the viewer asks it to design a model or to write report text.
 */
(function () {
"use strict";
var H = window.HUB;
var esc = H.esc;
var NC = null, PANEL = null, LOADING = null, ECON = null, ECON_LOADING = null, CCX = null;
var S = {
  sub: "overview",
  acc: { win: "all", lag: "standard", hz: "H3", show: "main" },
  predModel: null, avfH: null,
  lab: { family: "midas", predictors: ["usd_uzs_mom_dlog"], options: {}, form: "auto", from: null, name: null, horizons: ["H1", "H2", "H3"], lagMode: "standard", result: null, running: false, custom: [], ai: { q: "", text: "", ctl: null } },
  runs: [],                       // lab runs saved for reports
  rep: { title: "", lang: null, length: "standard", audience: "policy", topics: null, ai: true, style: "line", tables: true, busy: false, html: "", ctl: null, status: "" },
  calc: { model: null, spec: null, q: null, h: null, lag: null, from: "overview", key: null, W: null, err: null, track: null },
  trust: { h: null, lag: "standard" }
};
var SUBS = ["overview", "accuracy", "calc", "lab", "reports", "data", "method"];

/* ---------------- language ---------------- */
var NT = {
  title: ["Uzbekistan real GDP nowcast", "Наукастинг реального ВВП Узбекистана", "O'zbekiston real YaIM naukastingi"],
  s_overview: ["Nowcast", "Наукаст", "Naukast"],
  s_accuracy: ["Models & accuracy", "Модели и точность", "Modellar va aniqlik"],
  s_lab: ["Model lab", "Лаборатория моделей", "Modellar laboratoriyasi"],
  s_reports: ["Report builder", "Конструктор отчётов", "Hisobot konstruktori"],
  s_data: ["Data & sources", "Данные и источники", "Ma'lumotlar va manbalar"],
  s_method: ["Methodology", "Методология", "Metodologiya"],
  loading: ["Loading the nowcast…", "Загрузка наукаста…", "Naukast yuklanmoqda…"],
  load_err: ["Could not load the nowcast files: {e}", "Не удалось загрузить файлы наукаста: {e}", "Naukast fayllarini yuklab bo'lmadi: {e}"],
  stage: ["Information stage {h} · origin {d}", "Информационный этап {h} · дата прогноза {d}", "Axborot bosqichi {h} · prognoz sanasi {d}"],
  updated: ["Updated {d} · latest usable monthly data: {m}", "Обновлено {d} · последние доступные месячные данные: {m}", "Yangilangan {d} · so'nggi foydalanish mumkin bo'lgan oylik ma'lumot: {m}"],
  headline: ["Headline nowcast", "Основной наукаст", "Asosiy naukast"],
  hl_members: ["{list}", "{list}", "{list}"],
  hl_acc: ["Pseudo-real-time error at {h}: RMSE {r} pp vs {b} pp for the AR(2) benchmark ({n} quarters, {a}–{z}); over all three stages {pr} vs {pb}.", "Ошибка в псевдореальном времени на этапе {h}: RMSE {r} п.п. против {b} п.п. у эталона AR(2) ({n} кварталов, {a}–{z}); по всем трём этапам {pr} против {pb}.", "{h} bosqichida psevdo-real vaqt xatosi: RMSE {r} f.p., AR(2) etalonida {b} f.p. ({n} chorak, {a}–{z}); uchala bosqich bo'yicha {pr} va {pb}."],
  hl_sel: ["How it is chosen: among combinations of exactly two models, the one with the lowest pseudo-real-time RMSE, pooled over the three information stages, {a}–{b} (chosen by IMRS on 6 October 2026; the previous headline, ensemble + bottom-up, is still shown). Every other model is reported next to it.", "Как выбран: среди комбинаций ровно двух моделей — с наименьшей RMSE в псевдореальном времени по всем трём информационным этапам, {a}–{b} (выбрана ИМИР 6 октября 2026 г.; прежний основной наукаст, ансамбль + модель «снизу вверх», по-прежнему показан). Все остальные модели показаны рядом.", "Qanday tanlangan: aynan ikki modeldan iborat kombinatsiyalar orasida {a}–{b} da uchala axborot bosqichi bo'yicha psevdo-real vaqtdagi RMSE eng kichik bo'lgani (IMRS tomonidan 2026-yil 6-oktabrda tanlangan; oldingi asosiy naukast — ansambl + quyidan-yuqoriga model — ham ko'rsatiladi). Boshqa barcha modellar yonida ko'rsatiladi."],
  hl_benchmark: ["Benchmark", "Эталон", "Etalon"],
  hl_desc_prod_v2_combination: ["IMRS's production nowcast (version 2): the average of a dynamic factor model and a MIDAS regression on the exchange rate. The factor model extracts one common factor, with two-month dynamics estimated by maximum likelihood, from eight monthly series — SIAT's industrial production volume index, producer prices, the USD/UZS and RUB/UZS exchange rates, the world gold price, broad money, foreign-currency reserves and POS card payments (to 2024) — fills in the months not yet released, and relates the factor's quarterly mean, together with the previous quarter's growth, to GDP growth. The MIDAS regression relates GDP growth to its previous value and the last three monthly changes of the USD/UZS rate. Both are estimated on the GDP figures as SIAT had published them at each date.", "Рабочий наукаст ИМИР (версия 2): среднее динамической факторной модели и MIDAS-регрессии по валютному курсу. Факторная модель выделяет один общий фактор с двухмесячной динамикой, оцениваемой методом максимального правдоподобия, из восьми месячных рядов — индекса физического объёма промышленного производства Агентства статистики, цен производителей, курсов USD/UZS и RUB/UZS, мировой цены золота, широкой денежной массы, валютных резервов и платежей через POS-терминалы (до 2024 г.), — заполняет ещё не опубликованные месяцы и связывает среднее значение фактора за квартал вместе с ростом предыдущего квартала с ростом ВВП. MIDAS-регрессия связывает рост ВВП с его предыдущим значением и тремя последними месячными изменениями курса USD/UZS. Обе модели оцениваются на данных ВВП в том виде, в каком Агентство статистики публиковало их на каждую дату.", "IMRSning ishchi naukasti (2-versiya): dinamik omil modeli va valyuta kursi bo'yicha MIDAS regressiyasining o'rtachasi. Omil modeli sakkizta oylik qatordan — Statistika agentligining sanoat ishlab chiqarishi fizik hajmi indeksi, ishlab chiqaruvchilar narxlari, USD/UZS va RUB/UZS kurslari, jahon oltin narxi, keng pul massasi, valyuta zaxiralari va POS-terminallar orqali to'lovlar (2024-yilgacha) — maksimal haqiqatga o'xshashlik usulida baholanadigan ikki oylik dinamikaga ega bitta umumiy omil ajratadi, hali e'lon qilinmagan oylarni to'ldiradi va omilning choraklik o'rtachasini oldingi chorak o'sishi bilan birga YaIM o'sishi bilan bog'laydi. MIDAS regressiyasi YaIM o'sishini uning oldingi qiymati va USD/UZS kursining so'nggi uchta oylik o'zgarishi bilan bog'laydi. Ikkala model ham YaIM ma'lumotlarida Statistika agentligi har bir sanada e'lon qilgan ko'rinishda baholanadi."],
  hl_sel_prod_v2_combination: ["How it was chosen: IMRS's production model, the Hub's headline since 7 October 2026. IMRS promoted it on a matched out-of-sample comparison of 12 forecasts (2025Q3–2026Q2, scored against SIAT's first release), where its RMSE was 0.58 pp against 0.68 and 0.69 for its two models alone and 0.70 for IMRS's previous production model. The Hub reproduces the production forecasts exactly; its pseudo-real-time record here starts in 2022Q3. The two previous headlines are still shown.", "Как выбран: рабочая модель ИМИР, основной наукаст Хаба с 7 октября 2026 г. ИМИР выбрал её по сопоставимому сравнению вне обучающей выборки на 12 прогнозах (2025Q3–2026Q2, сравнение с первой публикацией Агентства статистики), где её RMSE составила 0,58 п.п. против 0,68 и 0,69 у двух её моделей по отдельности и 0,70 у прежней рабочей модели ИМИР. Хаб точно воспроизводит рабочие прогнозы; история в псевдореальном времени здесь начинается с 2022Q3. Два прежних основных наукаста по-прежнему показаны.", "Qanday tanlangan: IMRSning ishchi modeli, 2026-yil 7-oktabrdan Hubning asosiy naukasti. IMRS uni o'quv tanlovidan tashqaridagi 12 ta prognozni taqqoslash asosida tanlagan (2025Q3–2026Q2, Statistika agentligining birinchi e'loni bilan solishtirilgan): u yerda uning RMSE 0,58 f.p., ikkita modelining alohida 0,68 va 0,69, IMRSning oldingi ishchi modeli esa 0,70 bo'lgan. Hub ishchi prognozlarni aniq takrorlaydi; bu yerdagi psevdo-real vaqt tarixi 2022Q3 dan boshlanadi. Ikkita oldingi asosiy naukast ham ko'rsatiladi."],
  hl_fallback: ["The headline has no value at this stage ({r}); shown instead: {m}, {v}.", "Основной наукаст на этом этапе не рассчитан ({r}); вместо него показан: {m}, {v}.", "Bu bosqichda asosiy naukast hisoblanmadi ({r}); uning o'rniga ko'rsatilgan: {m}, {v}."],
  cmp_title: ["The headline next to its models and the previous headlines (same quarters and stages)", "Основной наукаст рядом с его моделями и прежними основными наукастами (те же кварталы и этапы)", "Asosiy naukast uning modellari va oldingi asosiy naukastlar yonida (bir xil choraklar va bosqichlar)"],
  cmp_latest: ["RMSE vs today's GDP", "RMSE к текущим данным ВВП", "Bugungi YaIMga nisbatan RMSE"],
  cmp_first: ["RMSE vs first release", "RMSE к первой публикации", "Birinchi e'longa nisbatan RMSE"],
  cmp_test: ["RMSE {a}–{b}", "RMSE {a}–{b}", "RMSE {a}–{b}"],
  cmp_note: ["Pseudo-real-time forecasts at H1–H3 (standard lags) on the {n} quarter-stage pairs where the headline has a forecast, {a}–{z}. SIAT's later revisions moved these quarters' growth by up to {r} pp. The headline's models train on the figures as first published, so they track the first release; the previous headlines train on today's figures and track the revised ones.", "Прогнозы в псевдореальном времени на этапах H1–H3 (стандартные лаги) на {n} парах «квартал–этап», где есть прогноз основного наукаста, {a}–{z}. Последующие пересмотры Агентства статистики изменили рост этих кварталов до {r} п.п. Модели основного наукаста обучаются на первоначально опубликованных данных и поэтому нацелены на первую публикацию; прежние основные наукасты обучаются на сегодняшних данных и следуют пересмотренным цифрам.", "H1–H3 bosqichlaridagi psevdo-real vaqt prognozlari (standart kechikishlar), asosiy naukast prognozi bor {n} ta «chorak–bosqich» juftligida, {a}–{z}. Statistika agentligining keyingi qayta ko'rib chiqishlari bu choraklar o'sishini {r} f.p. gacha o'zgartirgan. Asosiy naukast modellari dastlab e'lon qilingan ma'lumotlarda o'qitiladi, shuning uchun birinchi e'longa mo'ljallangan; oldingi asosiy naukastlar bugungi ma'lumotlarda o'qitiladi va qayta ko'rib chiqilgan raqamlarga ergashadi."],
  range_first: ["Against SIAT's first release, which the headline's models target, the same forecasts' error at this stage is ± {f} pp ({n} quarters).", "К первой публикации Агентства статистики, на которую нацелены модели основного наукаста, ошибка тех же прогнозов на этом этапе ± {f} п.п. ({n} кварталов).", "Asosiy naukast modellari mo'ljallangan Statistika agentligining birinchi e'loniga nisbatan shu prognozlarning bu bosqichdagi xatosi ± {f} f.p. ({n} chorak)."],
  role_previous: ["previous headline", "прежний основной", "oldingi asosiy"],
  term_intercept: ["intercept", "константа", "konstanta"],
  term_factor: ["factor, mean of {q}'s three months", "фактор, среднее за три месяца {q}", "omil, {q} ning uch oyi o'rtachasi"],
  term_gdp: ["GDP growth {q} (as published)", "рост ВВП {q} (как опубликован)", "YaIM o'sishi {q} (e'lon qilinganidek)"],
  term_usd: ["USD/UZS change, {m}", "изменение USD/UZS, {m}", "USD/UZS o'zgarishi, {m}"],
  news_gdp: ["GDP figures published between the stages", "Данные ВВП, опубликованные между этапами", "Bosqichlar orasida e'lon qilingan YaIM ma'lumotlari"],
  news_other: ["other changes", "прочие изменения", "boshqa o'zgarishlar"],
  news_umidas: ["{s} (U-MIDAS re-estimated for the new stage)", "{s} (U-MIDAS переоценена для нового этапа)", "{s} (U-MIDAS yangi bosqich uchun qayta baholangan)"],
  mon_news_missing: ["A model of the headline has no forecast at one of the two stages.", "У одной из моделей основного наукаста нет прогноза на одном из двух этапов.", "Asosiy naukast modellaridan birida ikki bosqichdan birida prognoz yo'q."],
  used_dfm: ["Factor model", "Факторная модель", "Omil modeli"], used_both: ["Factor model and U-MIDAS", "Факторная модель и U-MIDAS", "Omil modeli va U-MIDAS"],
  mon_bias_first: ["Bias vs first release", "Смещение к первой публикации", "Birinchi e'longa nisbatan siljish"], mon_bias_last: ["Bias vs latest", "Смещение к последним данным", "Oxirgi ma'lumotlarga nisbatan siljish"],
  mon_bias_note: ["Bias = mean of actual − forecast (positive: the forecasts were too low).", "Смещение = среднее (факт − прогноз); положительное — прогнозы были занижены.", "Siljish = (haqiqiy − prognoz) o'rtachasi; musbat — prognozlar past bo'lgan."],
  mon_rev_title: ["SIAT's revisions of GDP growth, first release → today ({n} quarters)", "Пересмотры роста ВВП Агентством статистики, первая публикация → сегодня ({n} кварталов)", "Statistika agentligining YaIM o'sishini qayta ko'rib chiqishlari, birinchi e'lon → bugun ({n} chorak)"],
  mon_rev_first: ["First release, %", "Первая публикация, %", "Birinchi e'lon, %"], mon_rev_diff: ["Revision, pp", "Пересмотр, п.п.", "Qayta ko'rib chiqish, f.p."], mon_rev_n: ["Figures published", "Опубликовано значений", "E'lon qilingan qiymatlar"],
  mon_info_src: ["Source", "Источник", "Manba"], mon_info_more: ["All {n} quarters", "Все кварталы ({n})", "Barcha {n} chorak"],
  mon_info_note: ["The headline's two models are estimated on these figures: for each quarter, the latest figure SIAT had published by the forecast origin. Bold: revised since.", "Две модели основного наукаста оцениваются на этих данных: для каждого квартала — последнее значение, опубликованное Агентством статистики к дате прогноза. Жирным — пересмотрено позже.", "Asosiy naukastning ikkala modeli shu ma'lumotlarda baholanadi: har bir chorak uchun Statistika agentligi prognoz sanasigacha e'lon qilgan oxirgi qiymat. Qalin — keyinroq qayta ko'rib chiqilgan."],
  hl_desc_bu_kalman_combination: ["Average of two complementary models. GDP growth is published year to date, so by the time a quarter is nowcast part of its figure is already known (the earlier quarters of the year); the year-to-date bottom-up model starts from each sector's published growth and moves it with SIAT's monthly industry, construction and trade releases. The Kalman factor model extracts one common factor from eight monthly series (industry and its mining, manufacturing and utilities branches, retail and wholesale trade, real M2 = money growth minus CPI inflation, and the USD/UZS exchange rate), fills the months not yet released, and relates the factor to the quarter's GDP growth.", "Среднее двух дополняющих друг друга моделей. Рост ВВП публикуется нарастающим итогом с начала года, поэтому к моменту наукаста часть значения уже известна (предыдущие кварталы года); восходящая модель с начала года берёт опубликованный рост каждой отрасли и сдвигает его по месячным данным Агентства статистики о промышленности, строительстве и торговле. Факторная модель с фильтром Калмана выделяет один общий фактор из восьми месячных рядов (промышленность и её отрасли — добыча, обработка, энергетика; розничная и оптовая торговля; реальная M2 = рост денежной массы минус инфляция ИПЦ; курс USD/UZS), заполняет ещё не опубликованные месяцы и связывает фактор с ростом ВВП квартала.", "Ikki bir-birini to'ldiruvchi modelning o'rtachasi. YaIM o'sishi yil boshidan jamlab e'lon qilinadi, shuning uchun naukast vaqtida qiymatning bir qismi ma'lum (yilning oldingi choraklari); yil boshidan quyidan-yuqoriga model har bir tarmoqning e'lon qilingan o'sishidan boshlab, uni Statistika agentligining sanoat, qurilish va savdo bo'yicha oylik ma'lumotlari bilan siljitadi. Kalman filtrli omil modeli sakkizta oylik qatordan (sanoat va uning tarmoqlari — tog'-kon, ishlab chiqarish, energetika; chakana va ulgurji savdo; real M2 = pul massasi o'sishi minus IIN inflyatsiyasi; USD/UZS kursi) bitta umumiy omil ajratadi, hali e'lon qilinmagan oylarni to'ldiradi va omilni chorak YaIM o'sishi bilan bog'laydi."],
  hl_desc_ytd_combination: ["Average of two complementary models. GDP growth is published year to date, so by the time a quarter is nowcast part of its figure is already known (the earlier quarters of the year); the year-to-date bottom-up model starts from each sector's published growth and moves it with SIAT's monthly industry, construction and trade releases. The ensemble (AR(2) and a MIDAS regression on the monthly USD/UZS exchange rate) adds GDP's own dynamics and the exchange-rate signal.", "Среднее двух дополняющих друг друга моделей. Рост ВВП публикуется нарастающим итогом с начала года, поэтому к моменту наукаста часть значения уже известна (предыдущие кварталы года); восходящая модель с начала года берёт опубликованный рост каждой отрасли и сдвигает его по месячным данным Агентства статистики о промышленности, строительстве и торговле. Ансамбль (AR(2) и MIDAS-регрессия по месячному курсу USD/UZS) добавляет собственную динамику ВВП и сигнал валютного курса.", "Ikki bir-birini to'ldiruvchi modelning o'rtachasi. YaIM o'sishi yil boshidan jamlab e'lon qilinadi, shuning uchun naukast vaqtida qiymatning bir qismi ma'lum (yilning oldingi choraklari); yil boshidan quyidan-yuqoriga model har bir tarmoqning e'lon qilingan o'sishidan boshlab, uni Statistika agentligining sanoat, qurilish va savdo bo'yicha oylik ma'lumotlari bilan siljitadi. Ansambl (AR(2) va oylik USD/UZS kursi bo'yicha MIDAS regressiyasi) YaIMning o'z dinamikasi va valyuta kursi signalini qo'shadi."],
  pick: ["Models shown", "Показанные модели", "Ko'rsatilgan modellar"],
  pick_default: ["Default", "По умолчанию", "Standart"], pick_clear: ["Clear", "Очистить", "Tozalash"],
  pick_note: ["Tick the models to draw; the choice is kept in this browser.", "Отметьте модели для графика; выбор сохраняется в этом браузере.", "Grafik uchun modellarni belgilang; tanlov shu brauzerda saqlanadi."],
  gdp_yoy: ["Real GDP growth, year to date (% vs the same months a year earlier)", "Рост реального ВВП с начала года (% к тем же месяцам прошлого года)", "Real YaIM o'sishi, yil boshidan (o'tgan yilning shu oylariga nisbatan %)"],
  ytd_note: ["SIAT publishes quarterly GDP growth cumulatively from January: Q1 covers January–March, Q2 January–June, Q3 January–September and Q4 the whole year, each compared with the same months a year earlier. The nowcast of {q} is therefore growth for {span}.", "Агентство статистики публикует квартальный рост ВВП нарастающим итогом с начала года: I квартал — январь–март, II — январь–июнь, III — январь–сентябрь, IV — весь год, каждый к тем же месяцам прошлого года. Поэтому наукаст {q} — это рост за {span}.", "Statistika agentligi choraklik YaIM o'sishini yil boshidan jamlab e'lon qiladi: I chorak — yanvar–mart, II — yanvar–iyun, III — yanvar–sentabr, IV — butun yil, har biri o'tgan yilning shu oylariga nisbatan. Shuning uchun {q} naukasti {span} uchun o'sishdir."],
  range: ["Indicative range {a} to {b} (± {h} pp: historical error of {n} pseudo-real-time forecasts at this stage; not a confidence interval)", "Ориентировочный диапазон {a}–{b} (± {h} п.п.: историческая ошибка {n} прогнозов в псевдореальном времени на этом этапе; не доверительный интервал)", "Taxminiy oraliq {a}–{b} (± {h} f.p.: shu bosqichdagi {n} ta psevdo-real vaqt prognozining tarixiy xatosi; ishonch oralig'i emas)"],
  latest_gdp: ["Latest official GDP", "Последний официальный ВВП", "So'nggi rasmiy YaIM"],
  indicators_usable: ["Indicators usable", "Доступные индикаторы", "Foydalanish mumkin bo'lgan ko'rsatkichlar"],
  target_months: ["Indicator-months inside {q}", "Индикаторо-месяцев внутри {q}", "{q} ichidagi ko'rsatkich-oylar"],
  conservative: ["With conservative release lags", "При консервативных лагах публикации", "Konservativ e'lon kechikishlarida"],
  mon_status_pending: ["Chosen on a matched out-of-sample comparison (2025Q3–2026Q2); validation on new quarters pending ({n} quarters published since adoption on {d}).", "Выбран по сопоставимому сравнению вне обучающей выборки (2025Q3–2026Q2); проверка на новых кварталах ещё не проведена (опубликовано кварталов после принятия {d}: {n}).", "O'quv tanlovidan tashqari taqqoslash (2025Q3–2026Q2) bo'yicha tanlangan; yangi choraklarda tekshiruv kutilmoqda ({d} da qabul qilingandan keyin e'lon qilingan choraklar: {n})."],
  mon_status_progress: ["Prospective validation in progress: {n} quarters published since adoption on {d}.", "Проверка на новых данных идёт: опубликовано кварталов после принятия {d}: {n}.", "Yangi ma'lumotlarda tekshiruv davom etmoqda: {d} dan keyin e'lon qilingan choraklar: {n}."],
  mon_range: ["Indicative range: headline ± its historical RMSE at this stage; not a formal confidence interval.", "Ориентировочный диапазон: основной наукаст ± его историческая RMSE на этом этапе; это не доверительный интервал.", "Taxminiy oraliq: asosiy naukast ± shu bosqichdagi tarixiy RMSE; bu ishonch oralig'i emas."],
  mon_terms_title: ["How the headline is calculated (exact terms)", "Как рассчитан основной наукаст (точные слагаемые)", "Asosiy naukast qanday hisoblangan (aniq qo'shiluvchilar)"],
  mon_terms_note: ["Each term is in percentage points of the headline; the terms add up to {v}. Factor model: half of (intercept + coefficient × the factor's mean over the quarter + coefficient × the previous quarter's growth as published). U-MIDAS: half of (intercept + coefficient × the previous quarter's growth + a coefficient × each of the last three monthly USD/UZS changes).", "Каждое слагаемое — в п.п. основного наукаста; сумма равна {v}. Факторная модель: половина от (константа + коэффициент × среднее значение фактора за квартал + коэффициент × опубликованный рост прошлого квартала). U-MIDAS: половина от (константа + коэффициент × рост прошлого квартала + коэффициенты × три последних месячных изменения курса USD/UZS).", "Har bir qo'shiluvchi asosiy naukastning f.p.da; yig'indisi {v}. Omil modeli: (konstanta + koeffitsient × chorakdagi omil o'rtachasi + koeffitsient × oldingi chorakning e'lon qilingan o'sishi) ning yarmi. U-MIDAS: (konstanta + koeffitsient × oldingi chorak o'sishi + koeffitsientlar × USD/UZS kursining so'nggi uchta oylik o'zgarishi) ning yarmi."],
  mon_term: ["Term", "Слагаемое", "Qo'shiluvchi"], mon_member: ["Member", "Модель", "Model"], mon_calc: ["Calculation", "Расчёт", "Hisob"], mon_pp: ["pp", "п.п.", "f.p."],
  mon_total: ["Headline", "Основной наукаст", "Asosiy naukast"],
  mon_news_title: ["What changed since the previous stage ({a} → {b})", "Что изменилось с прошлого этапа ({a} → {b})", "Oldingi bosqichdan beri nima o'zgardi ({a} → {b})"],
  mon_news_sum: ["Headline {d} pp: factor model {u} pp, U-MIDAS {k} pp.", "Основной наукаст {d} п.п.: факторная модель {u} п.п., U-MIDAS {k} п.п.", "Asosiy naukast {d} f.p.: omil modeli {u} f.p., U-MIDAS {k} f.p."],
  mon_news_note: ["GDP figures published between the two stages come first; then each series' newly released months are added to the factor model in order of release lag, re-estimating the model at every step; last, the U-MIDAS at the new stage (a separate regression for each stage). The steps add up to the change but depend on that order.", "Сначала — данные ВВП, опубликованные между этапами; затем новые месяцы каждого ряда добавляются в факторную модель в порядке лага публикации с переоценкой модели на каждом шаге; в конце — U-MIDAS на новом этапе (для каждого этапа своя регрессия). Шаги в сумме дают изменение, но зависят от порядка.", "Avval — bosqichlar orasida e'lon qilingan YaIM ma'lumotlari; so'ngra har bir qatorning yangi oylari omil modeliga e'lon kechikishi tartibida qo'shiladi va model har qadamda qayta baholanadi; oxirida — yangi bosqichdagi U-MIDAS (har bir bosqich uchun alohida regressiya). Qadamlar yig'indisi o'zgarishga teng, lekin tartibga bog'liq."],
  mon_news_first: ["First information stage of the quarter: nothing earlier to compare with.", "Первый информационный этап квартала: сравнивать не с чем.", "Chorakning birinchi axborot bosqichi: solishtirish uchun oldingi bosqich yo'q."],
  mon_source: ["Source of change", "Источник изменения", "O'zgarish manbai"], mon_months: ["New months", "Новые месяцы", "Yangi oylar"],
  mon_fresh_title: ["Input freshness ({d})", "Актуальность входных данных ({d})", "Kirish ma'lumotlarining yangiligi ({d})"],
  mon_fresh_note: ["Expected = latest month whose release date (month end + release lag) has passed. CURRENT: in the Hub; LAGGED: one month late; STALE: two or more; WITHHELD: not used after a date by the model's specification (POS turnover after 2024-12).", "Ожидается = последний месяц, дата публикации которого (конец месяца + лаг) прошла. CURRENT — есть в Хабе; LAGGED — запаздывает на месяц; STALE — на два и более; WITHHELD — по спецификации модели не используется после даты (оборот POS после 2024-12).", "Kutilgan = e'lon sanasi (oy oxiri + kechikish) o'tgan oxirgi oy. CURRENT — Hubda bor; LAGGED — bir oy kechikkan; STALE — ikki va undan ko'p; WITHHELD — model spetsifikatsiyasiga ko'ra sanadan keyin ishlatilmaydi (POS aylanmasi 2024-12 dan keyin)."],
  mon_fresh_gdp: ["GDP: latest quarter used {q} (published {d}, {o}); expected by now: {e}.", "ВВП: последний используемый квартал {q} (опубликован {d}, {o}); ожидается к этой дате: {e}.", "YaIM: ishlatilgan so'nggi chorak {q} ({d} da e'lon qilingan, {o}); shu sanagacha kutilgan: {e}."],
  src_doc: ["documented release", "задокументированная публикация", "hujjatlashtirilgan e'lon"], src_hub: ["Hub record", "запись Хаба", "Hub yozuvi"],
  mon_sig_title: ["Factor model: loading signals of {q} (descriptive)", "Факторная модель: сигналы нагрузок за {q} (описательно)", "Omil modeli: {q} yuklama signallari (tavsifiy)"],
  mon_sig_note: ["Signal = loading × mean standardised value of the series' months of {q} released by the origin; share = its part of the total absolute signal. The factor is a Kalman-filtered state, so these are descriptive weights of evidence, not additive contributions to the nowcast.", "Сигнал = нагрузка × среднее стандартизованное значение месяцев {q}, опубликованных к дате прогноза; доля — его часть в сумме модулей сигналов. Фактор — оценка фильтра Калмана, поэтому это описательные веса, а не слагаемые наукаста.", "Signal = yuklama × prognoz sanasigacha e'lon qilingan {q} oylarining standartlashtirilgan o'rtacha qiymati; ulush — signallar modullari yig'indisidagi qismi. Omil Kalman filtri bahosi, shuning uchun bular tavsifiy vaznlar, naukastning qo'shiluvchilari emas."],
  mon_sig_series: ["Series", "Ряд", "Qator"], mon_sig_load: ["Loading", "Нагрузка", "Yuklama"], mon_sig_months: ["Months released", "Опубликовано месяцев", "E'lon qilingan oylar"], mon_sig_z: ["Mean z", "Среднее z", "O'rtacha z"], mon_sig_sig: ["Signal", "Сигнал", "Signal"], mon_sig_share: ["Share", "Доля", "Ulush"],
  mon_info_title: ["GDP figures the headline used for {q} (as published by {d})", "Данные ВВП, использованные основным наукастом для {q} (как опубликовано к {d})", "Asosiy naukast {q} uchun ishlatgan YaIM ma'lumotlari ({d} gacha e'lon qilinganidek)"],
  mon_info_used: ["Figure used, %", "Использовано, %", "Ishlatilgan, %"], mon_info_pub: ["Published", "Опубликовано", "E'lon qilingan"], mon_info_now: ["Today, %", "Сегодня, %", "Bugun, %"],
  mon_repro: ["Reproduction check against IMRS's production run (commit {c}): {n} forecasts compared — its pseudo-real-time record and its nowcast of 5 October 2026 ({v}%); largest difference {d} pp:", "Проверка воспроизведения рабочего расчёта ИМИР (коммит {c}): сопоставлено прогнозов — {n}: история в псевдореальном времени и наукаст от 5 октября 2026 г. ({v}%); наибольшее расхождение {d} п.п.:", "IMRS ishchi hisobini takrorlash tekshiruvi (kommit {c}): {n} ta prognoz solishtirildi — psevdo-real vaqt tarixi va 2026-yil 5-oktabrdagi naukast ({v}%); eng katta farq {d} f.p.:"],
  repro_ok: ["reproduced", "воспроизведено", "takrorlandi"], repro_diff: ["differs (an input series was revised since the production run, or the Hub's copy differs)", "расходится (входной ряд пересмотрен после рабочего расчёта или копия Хаба отличается)", "farq bor (kirish qatori ishchi hisobdan keyin qayta ko'rib chiqilgan yoki Hub nusxasi farq qiladi)"],
  mon_input: ["Input", "Показатель", "Ko'rsatkich"], mon_used: ["Used by", "Модель", "Model"], mon_latest: ["Latest in Hub", "Последний в Хабе", "Hubdagi oxirgisi"], mon_expected: ["Expected", "Ожидается", "Kutilgan"], mon_status: ["Status", "Статус", "Holat"], mon_fetched: ["Collected", "Собрано", "Yig'ilgan"],
  mon_stale_other: ["Other registry series that are stale: {l}.", "Другие устаревшие ряды реестра: {l}.", "Reyestrdagi boshqa eskirgan qatorlar: {l}."],
  mon_log_title: ["Published nowcast log", "Журнал опубликованных наукастов", "E'lon qilingan naukastlar jurnali"],
  mon_log_note: ["Every stored run (standard lags). Revision = change from the previous run for the same quarter; ✱ = headline model changed.", "Каждый сохранённый запуск (стандартные лаги). Пересмотр = изменение к прошлому запуску для того же квартала; ✱ — сменилась модель основного наукаста.", "Har bir saqlangan ishga tushirish (standart kechikishlar). Qayta ko'rib chiqish = shu chorak uchun oldingi ishga tushirishdan o'zgarish; ✱ — asosiy model almashgan."],
  mon_run: ["Run (UTC)", "Запуск (UTC)", "Ishga tushirish (UTC)"], mon_target: ["Quarter", "Квартал", "Chorak"], mon_stage: ["Stage", "Этап", "Bosqich"], mon_value: ["Headline", "Наукаст", "Naukast"], mon_rev: ["Revision", "Пересмотр", "Qayta ko'rib chiqish"],
  mon_vint_title: ["First-release scoring", "Оценка по первым публикациям ВВП", "YaIMning birinchi e'lonlari bo'yicha baholash"],
  mon_vint_note: ["SIAT revises GDP growth for years after its first release. The headline's two models train on the figures as they were published at each date (the releases documented by IMRS for 2018Q3–2026Q2 and, from {d}, every figure the Hub reads in SIAT table 3698), so they target the first release; the other models train on today's figures. Scores against the first release ({n} quarters documented) and against today's figures, on the headline's quarters and stages; quarters revised since their first release: {r}.", "Агентство статистики пересматривает рост ВВП в течение нескольких лет после первой публикации. Две модели основного наукаста обучаются на данных в том виде, в каком они публиковались на каждую дату (задокументированные ИМИР публикации за 2018Q3–2026Q2 и, с {d}, все цифры, которые Хаб считывает в таблице SIAT 3698), то есть нацелены на первую публикацию; остальные модели обучаются на сегодняшних данных. Ошибки к первой публикации ({n} задокументированных кварталов) и к сегодняшним данным, на кварталах и этапах основного наукаста; кварталов, пересмотренных после первой публикации: {r}.", "Statistika agentligi YaIM o'sishini birinchi e'londan keyin bir necha yil davomida qayta ko'rib chiqadi. Asosiy naukastning ikkala modeli ma'lumotlarda har bir sanada e'lon qilingan ko'rinishda o'qitiladi (IMRS hujjatlashtirgan 2018Q3–2026Q2 e'lonlari va {d} dan Hub SIAT 3698 jadvalida o'qiydigan barcha raqamlar), ya'ni birinchi e'longa mo'ljallangan; boshqa modellar bugungi ma'lumotlarda o'qitiladi. Birinchi e'longa ({n} ta hujjatlashtirilgan chorak) va bugungi ma'lumotlarga nisbatan xatolar, asosiy naukastning choraklari va bosqichlarida; birinchi e'londan keyin qayta ko'rib chiqilgan choraklar: {r}."],
  mon_first: ["RMSE vs first release", "RMSE к первой публикации", "Birinchi e'longa nisbatan RMSE"], mon_last: ["RMSE vs latest", "RMSE к последним данным", "Oxirgi ma'lumotlarga nisbatan RMSE"],
  flash_title: ["Flash estimate (stage H4: the quarter's monthly data complete)", "Флэш-оценка (этап H4: месячные данные квартала полные)", "Tezkor baho (H4 bosqichi: chorakning oylik ma'lumotlari to'liq)"],
  flash_pending: ["For {q}: from {d}, when the third month of every indicator is out (SIAT usually publishes GDP about then).", "Для {q}: с {d}, когда выйдет третий месяц всех индикаторов (примерно тогда же Агентство обычно публикует ВВП).", "{q} uchun: {d} dan, barcha ko'rsatkichlarning uchinchi oyi chiqqanda (Agentlik odatda YaIMni taxminan shu paytda e'lon qiladi)."],
  flash_value: ["{q}: {v} (bottom-up {b}, ensemble at H3 {e}).", "{q}: {v} (снизу вверх {b}, ансамбль на этапе H3 {e}).", "{q}: {v} (quyidan yuqoriga {b}, H3 dagi ansambl {e})."],
  flash_acc: ["Track record {a}–{z} ({n} quarters, standard lags): RMSE {f} pp; on the {hn} quarters where the headline has an H3 forecast, {fm} pp against {h} pp for the headline; {t} pp in {ta}–{tz}.", "История {a}–{z} ({n} кварталов, стандартные лаги): RMSE {f} п.п.; на {hn} кварталах, где есть прогноз основного наукаста на H3, {fm} п.п. против {h} п.п. у основного наукаста; {t} п.п. в {ta}–{tz}.", "Tarix {a}–{z} ({n} chorak, standart kechikishlar): RMSE {f} f.p.; asosiy naukastning H3 prognozi bor {hn} chorakda {fm} f.p., asosiy naukastda esa {h} f.p.; {ta}–{tz} da {t} f.p."],
  flash_note: ["0.5 × the ensemble at H3 + 0.5 × the year-to-date bottom-up model with the whole quarter's industry, construction and trade indices (in Q1 too). It arrives with the GDP release, not ahead of it, so it never replaces the headline: it shows what the quarter's monthly data imply. Most of its gain is in first quarters, which use their January–March indices only at this stage; for Q2–Q4 the complete quarter adds little.", "0,5 × ансамбль на H3 + 0,5 × модель «снизу вверх» с индексами промышленности, строительства и торговли за весь квартал (и в I квартале). Она появляется одновременно с публикацией ВВП, а не раньше, поэтому не заменяет основной наукаст: она показывает, что следует из месячных данных квартала. Основной выигрыш приходится на I квартал, который использует индексы января–марта только на этом этапе; для II–IV кварталов полный квартал добавляет мало.", "0,5 × H3 dagi ansambl + 0,5 × butun chorak sanoat, qurilish va savdo indekslari bilan quyidan yuqoriga model (I chorakda ham). U YaIM e'lon qilinishi bilan birga chiqadi, oldin emas, shuning uchun asosiy naukast o'rnini bosmaydi: chorakning oylik ma'lumotlari nimani anglatishini ko'rsatadi. Asosiy yutuq I chorakka to'g'ri keladi, u yanvar–mart indekslaridan faqat shu bosqichda foydalanadi; II–IV choraklar uchun to'liq chorak kam qo'shadi."],
  components: ["How the headline is built", "Из чего состоит основной наукаст", "Asosiy naukast qanday tuziladi"],
  align_warn: ["The {m} USD/UZS average is still partial, so the U-MIDAS regressions on the USD/UZS rate (the headline's and the ensemble's) read a window their coefficients were not estimated on. At the previous stage ({h}) the headline was {v}% and its U-MIDAS {u}%. Expect a revision once the month closes.", "Средний курс USD/UZS за {m} ещё неполный, поэтому регрессии U-MIDAS по курсу USD/UZS (в основном наукасте и в ансамбле) используют окно, на котором их коэффициенты не оценивались. На предыдущем этапе ({h}) основной наукаст давал {v}%, его U-MIDAS — {u}%. После закрытия месяца возможен пересмотр.", "{m} uchun USD/UZS o'rtacha kursi hali to'liq emas, shu sababli USD/UZS kursi bo'yicha U-MIDAS regressiyalari (asosiy naukastda va ansamblda) koeffitsiyentlari baholanmagan oynadan foydalanmoqda. Oldingi bosqichda ({h}) asosiy naukast {v}%, uning U-MIDAS modeli {u}% edi. Oy yopilgach, qayta ko'rib chiqish kutiladi."],
  evolution: ["Nowcast of {q} by information stage", "Наукаст {q} по информационным этапам", "{q} naukasti axborot bosqichlari bo'yicha"],
  evolution_note: ["Each point uses only data released by that stage's cut-off (same data vintage).", "Каждая точка использует только данные, опубликованные к дате этапа.", "Har bir nuqta faqat shu bosqich sanasigacha e'lon qilingan ma'lumotlardan foydalanadi."],
  actual_vs: ["Official GDP growth and nowcasts made at stage {h}", "Официальный рост ВВП и наукасты этапа {h}", "Rasmiy YaIM o'sishi va {h} bosqichidagi naukastlar"],
  actual: ["Official GDP growth (year to date)", "Официальный рост ВВП (с начала года)", "Rasmiy YaIM o'sishi (yil boshidan)"],
  models_now: ["Every model's nowcast for {q}", "Наукасты всех моделей для {q}", "{q} uchun barcha modellarning naukastlari"],
  models_now_note: ["Point nowcasts at the current stage; bars: BVAR 68% and 90% bands. The dashed line is the headline.", "Точечные наукасты на текущем этапе; полосы: 68% и 90% интервалы BVAR. Пунктир — основной наукаст.", "Joriy bosqichdagi nuqtaviy naukastlar; chiziqlar: BVAR 68% va 90% oraliqlari. Uzuq chiziq — asosiy naukast."],
  window: ["Evaluation window", "Окно оценки", "Baholash oynasi"],
  win_all: ["All quarters {a}–{b}", "Все кварталы {a}–{b}", "Barcha choraklar {a}–{b}"],
  win_selection: ["Selection period {a}–{b}", "Период выбора {a}–{b}", "Tanlash davri {a}–{b}"],
  win_test: ["Test period {a}–{b}", "Проверочный период {a}–{b}", "Tekshiruv davri {a}–{b}"],
  win_record: ["Full record {a}–{b}", "Вся история {a}–{b}", "To'liq tarix {a}–{b}"],
  win_trial: ["Trial window from {a}", "Испытательный период с {a}", "Sinov davri {a} dan"],
  acc_first: ["First quarter", "Первый квартал", "Birinchi chorak"],
  acc_note_record: ["Full record: every quarter from {a}. Before {p} the models train on every published quarter from {e} (for 2016–2017 SIAT table 3122, the same GDP growth figure); from {p} on the quarters from {s}. Each model enters the record once its own minimum training sample is met (first-quarter column), so most indicator models start in 2019–2020. A model can also have gaps: the USD/UZS U-MIDAS, the ensemble and the two previous headlines need 15 training quarters, so they have no forecasts for 2021, when the production window starting in {s} is still shorter. The headline (IMRS production V2) trains only on GDP figures as published from 2018Q3 and on monthly data from 2019, so its record starts in 2022Q3; it has no forecast for 2022Q4, where its factor model fails the stability check (as in IMRS's production run). The spans differ between models: compare them with ÷ AR(2), computed on each model's own quarters. The record includes 2020, the pandemic year, when forecast errors were large.", "Вся история: каждый квартал с {a}. До {p} модели обучаются на всех опубликованных кварталах с {e} (для 2016–2017 гг. — таблица SIAT 3122, тот же показатель роста ВВП), с {p} — на кварталах с {s}. Модель входит в историю, когда набирает свою минимальную обучающую выборку (столбец «Первый квартал»), поэтому большинство моделей на индикаторах начинаются в 2019–2020 гг. У модели могут быть и пропуски: U-MIDAS по курсу USD/UZS, ансамбль и два прежних основных наукаста требуют 15 кварталов обучения, поэтому за 2021 год у них нет прогнозов — рабочее окно с {s} тогда ещё короче. Основной наукаст (рабочая модель ИМИР V2) обучается только на данных ВВП в том виде, в каком они публиковались, начиная с 2018Q3, и на месячных данных с 2019 г., поэтому его история начинается с 2022Q3; за 2022Q4 прогноза нет: его факторная модель не проходит проверку устойчивости (как и в рабочем расчёте ИМИР). Периоды у моделей разные: сравнивайте их по ÷ AR(2), рассчитанному на кварталах самой модели. История включает 2020 год пандемии, когда ошибки прогнозов были большими.", "To'liq tarix: {a} dan boshlab har bir chorak. {p} gacha modellar {e} dan boshlab e'lon qilingan barcha choraklarda o'qitiladi (2016–2017 yillar uchun SIAT 3122 jadvali, YaIM o'sishining o'sha ko'rsatkichi); {p} dan boshlab — {s} dan boshlangan choraklarda. Har bir model o'zining minimal o'quv tanlovi to'lganda tarixga kiradi (“Birinchi chorak” ustuni), shuning uchun ko'rsatkichli modellarning ko'pchiligi 2019–2020 yillardan boshlanadi. Modelda bo'shliqlar ham bo'lishi mumkin: USD/UZS bo'yicha U-MIDAS, ansambl va ikkita oldingi asosiy naukast 15 chorak o'qitishni talab qiladi, shuning uchun 2021 yil uchun ularda prognoz yo'q — {s} dan boshlanadigan ishchi oyna o'shanda hali qisqaroq. Asosiy naukast (IMRS ishchi modeli V2) faqat 2018Q3 dan boshlab e'lon qilingan ko'rinishdagi YaIM ma'lumotlarida va 2019-yildan oylik ma'lumotlarda o'qitiladi, shuning uchun uning tarixi 2022Q3 dan boshlanadi; 2022Q4 uchun prognoz yo'q: omil modeli barqarorlik tekshiruvidan o'tmaydi (IMRS ishchi hisobidagi kabi). Modellarning davrlari har xil: ularni modelning o'z choraklarida hisoblangan ÷ AR(2) bo'yicha taqqoslang. Tarixga pandemiya yili — 2020 yil kiradi, o'shanda prognoz xatolari katta bo'lgan."],
  lag: ["Release lags", "Лаги публикации", "E'lon kechikishi"],
  lag_standard: ["Standard", "Стандартные", "Standart"],
  lag_conservative: ["Conservative", "Консервативные", "Konservativ"],
  horizon: ["Stage", "Этап", "Bosqich"],
  pooled: ["Pooled", "Все этапы", "Barcha bosqichlar"],
  model: ["Model", "Модель", "Model"],
  family: ["Family", "Семейство", "Oila"],
  role: ["Role", "Роль", "Roli"],
  rel_ar2: ["RMSE ÷ AR(2)", "RMSE ÷ AR(2)", "RMSE ÷ AR(2)"],
  nowcast_now: ["Nowcast {q}", "Наукаст {q}", "Naukast {q}"],
  acc_note: ["Pseudo-real-time forecasts on an expanding window: each forecast uses only data released by its origin. Errors = actual − forecast. Values below 1 in the ÷ AR(2) column beat the AR(2) benchmark on the same quarters. The headline is IMRS's production model, chosen by IMRS on its own out-of-sample comparison (2025Q3–2026Q2, against SIAT's first release); its models train on GDP as first published, so these tables, scored against today's revised figures, understate it (see the first-release scoring on the Nowcast tab). The test period has six quarters, so rankings there are indicative.", "Прогнозы в псевдореальном времени на расширяющемся окне: каждый прогноз использует только данные, опубликованные к его дате. Ошибка = факт − прогноз. Значения меньше 1 в столбце ÷ AR(2) лучше эталона AR(2) на тех же кварталах. Основной наукаст — рабочая модель ИМИР, выбранная ИМИР по собственному сравнению вне обучающей выборки (2025Q3–2026Q2, к первой публикации Агентства статистики); его модели обучаются на первоначально опубликованных данных ВВП, поэтому эти таблицы, рассчитанные к сегодняшним пересмотренным данным, его недооценивают (см. оценку по первым публикациям на вкладке «Наукаст»). В проверочном периоде шесть кварталов, поэтому рейтинг там ориентировочный.", "Kengayib boruvchi oynada psevdo-real vaqt prognozlari: har bir prognoz faqat o'z sanasigacha e'lon qilingan ma'lumotlardan foydalanadi. Xato = haqiqiy − prognoz. ÷ AR(2) ustunidagi 1 dan kichik qiymatlar o'sha choraklarda AR(2) dan yaxshiroq. Asosiy naukast — IMRS ishchi modeli, uni IMRS o'quv tanlovidan tashqari o'z taqqoslashi asosida (2025Q3–2026Q2, Statistika agentligining birinchi e'loniga nisbatan) tanlagan; uning modellari YaIMning dastlab e'lon qilingan ma'lumotlarida o'qitiladi, shuning uchun bugungi qayta ko'rib chiqilgan ma'lumotlarga nisbatan hisoblangan bu jadvallar uni past baholaydi (“Naukast” bo'limidagi birinchi e'lonlar bo'yicha baholashga qarang). Tekshiruv davrida olti chorak bor, shuning uchun u yerdagi reyting taxminiy."],
  acc_show: ["Show", "Показать", "Ko'rsatish"], acc_main: ["Main models", "Основные модели", "Asosiy modellar"], acc_every: ["Every equation", "Все уравнения", "Barcha tenglamalar"],
  preds: ["Forecasts by quarter", "Прогнозы по кварталам", "Choraklar bo'yicha prognozlar"],
  quarter: ["Quarter", "Квартал", "Chorak"],
  role_headline: ["headline", "основной", "asosiy"], role_benchmark: ["benchmark", "эталон", "etalon"], role_model: ["model", "модель", "model"], role_combination: ["combination", "комбинация", "kombinatsiya"], role_single: ["single indicator", "один индикатор", "bitta ko'rsatkich"],
  role_experimental: ["experimental", "экспериментальная", "eksperimental"],
  specs: ["Model specifications", "Спецификации моделей", "Model spetsifikatsiyalari"],
  // calculations
  s_calc: ["Calculations", "Расчёты", "Hisob-kitoblar"],
  calc_btn: ["Calculations", "Расчёты", "Hisob-kitob"],
  calc_index_title: ["How every nowcast is calculated", "Как рассчитывается каждый наукаст", "Har bir naukast qanday hisoblanadi"],
  calc_intro: ["Choose a model to see exactly how its nowcast is built: the variables and the months it uses at the forecast origin, the training sample, every estimation step, and the final arithmetic. The model is re-estimated in your browser with the same code that reproduces the fortnightly run; everything can be downloaded to Excel.", "Выберите модель, чтобы увидеть, как именно построен её наукаст: переменные и месяцы на дату прогноза, обучающая выборка, каждый шаг оценки и итоговая арифметика. Модель переоценивается в браузере тем же кодом, который воспроизводит плановый расчёт; всё можно скачать в Excel.", "Naukast qanday tuzilganini ko'rish uchun modelni tanlang: prognoz sanasidagi o'zgaruvchilar va oylar, o'quv tanlovi, baholashning har bir bosqichi va yakuniy arifmetika. Model brauzeringizda rejali hisobni takrorlaydigan kod bilan qayta baholanadi; hammasini Excelga yuklab olish mumkin."],
  calc_title: ["How the nowcast of {m} was calculated", "Как рассчитан наукаст: {m}", "{m}: naukast qanday hisoblangan"],
  calc_back: ["← Back", "← Назад", "← Orqaga"],
  calc_all: ["All models", "Все модели", "Barcha modellar"],
  calc_model: ["Model", "Модель", "Model"],
  calc_quarter: ["Target quarter", "Целевой квартал", "Maqsad chorak"],
  calc_computing: ["Re-estimating the model…", "Модель переоценивается…", "Model qayta baholanmoqda…"],
  calc_origin: ["{q} · stage {h} · {l} release lags · forecast origin {d}", "{q} · этап {h} · лаги: {l} · дата прогноза {d}", "{q} · {h} bosqich · kechikish: {l} · prognoz sanasi {d}"],
  calc_check: ["Check: the fortnightly run published {v}; this recomputation differs by {d}.", "Проверка: плановый расчёт дал {v}; расхождение пересчёта {d}.", "Tekshiruv: rejali hisob {v} bergan; qayta hisob farqi {d}."],
  calc_actual: ["Official GDP growth {q} (year to date)", "Официальный рост ВВП {q} (с начала года)", "Rasmiy YaIM o'sishi {q} (yil boshidan)"],
  calc_error: ["Error (actual − nowcast)", "Ошибка (факт − наукаст)", "Xato (haqiqiy − naukast)"],
  calc_ntrain: ["Training rows", "Строк обучения", "O'quv qatorlari"],
  calc_spec: ["1. Specification", "1. Спецификация", "1. Spetsifikatsiya"],
  calc_vars: ["2. Variables and the information set at the forecast origin", "2. Переменные и информация на дату прогноза", "2. O'zgaruvchilar va prognoz sanasidagi axborot"],
  calc_vars_note: ["Pseudo-real time: today's data vintage, keeping only values that would have been published by {d} under the {l} release rule ({r}).", "Псевдореальное время: текущие данные, но только значения, опубликованные к {d} по правилу лагов «{l}» ({r}).", "Psevdo-real vaqt: bugungi ma'lumotlar, lekin faqat {d} gacha «{l}» qoidasi bo'yicha e'lon qilingan qiymatlar ({r})."],
  calc_est: ["3. Training data and estimation", "3. Обучающие данные и оценка", "3. O'quv ma'lumotlari va baholash"],
  calc_terms: ["4. The nowcast, term by term", "4. Наукаст по слагаемым", "4. Naukast qo'shiluvchilar bo'yicha"],
  calc_fit: ["5. Fitted values and residuals", "5. Подогнанные значения и остатки", "5. Moslangan qiymatlar va qoldiqlar"],
  calc_track: ["6. Track record: pseudo-real-time nowcasts at stage {h}, {l} lags", "6. История: наукасты в псевдореальном времени, этап {h}, лаги: {l}", "6. Tarix: psevdo-real vaqt naukastlari, {h} bosqich, kechikish: {l}"],
  calc_track_src: ["From the fortnightly run.", "Из планового расчёта.", "Rejali hisobdan."],
  calc_track_cmp: ["Computed in your browser with the same pseudo-real-time design.", "Рассчитано в браузере по той же схеме псевдореального времени.", "Brauzerda xuddi shu psevdo-real vaqt sxemasi bilan hisoblangan."],
  calc_xlsx: ["Download all calculations (Excel)", "Скачать все расчёты (Excel)", "Barcha hisob-kitoblarni yuklab olish (Excel)"],
  calc_json: ["Download as JSON", "Скачать JSON", "JSON yuklab olish"],
  calc_members: ["Members (open their calculations)", "Компоненты (откройте их расчёты)", "Tarkibiy modellar (hisob-kitoblarini oching)"],
  calc_vars_combo: ["A combination uses only the nowcasts of its members; open a member above to see its variables, data and estimation.", "Комбинация использует только наукасты своих компонентов; откройте компонент выше, чтобы увидеть его переменные, данные и оценку.", "Kombinatsiya faqat tarkibiy modellarning naukastlaridan foydalanadi; o'zgaruvchilar, ma'lumotlar va baholashni ko'rish uchun yuqoridagi modelni oching."],
  calc_total: ["Nowcast = sum of the contributions", "Наукаст = сумма вкладов", "Naukast = hissalar yig'indisi"],
  calc_failed: ["This model produced no nowcast at this origin: {f}", "Модель не дала наукаст на эту дату: {f}", "Model bu sanada naukast bermadi: {f}"],
  calc_rows: ["{n} rows", "{n} строк", "{n} qator"],
  cg_headline: ["Headline and its members", "Основной наукаст и его компоненты", "Asosiy naukast va uning tarkibi"],
  cg_benchmarks: ["Benchmarks", "Эталонные модели", "Etalon modellar"],
  cg_models: ["Models", "Модели", "Modellar"],
  cg_combinations: ["Combinations", "Комбинации", "Kombinatsiyalar"],
  cg_single: ["Single-indicator equations (members of the combinations)", "Уравнения по одному индикатору (компоненты комбинаций)", "Bitta ko'rsatkichli tenglamalar (kombinatsiyalar tarkibi)"],
  cg_experimental: ["Experimental models (re-tested every quarter, in no combination)", "Экспериментальные модели (перепроверяются каждый квартал, не входят в комбинации)", "Eksperimental modellar (har chorakda qayta tekshiriladi, kombinatsiyalarga kirmaydi)"],
  v_variable: ["Variable", "Переменная", "O'zgaruvchi"], v_role: ["Role", "Роль", "Roli"], v_transform: ["Transformation", "Преобразование", "O'zgartirish"],
  v_lag: ["Release lag, days", "Лаг публикации, дней", "E'lon kechikishi, kun"], v_due: ["Latest month due by the rule", "Последний месяц по правилу", "Qoida bo'yicha so'nggi oy"],
  v_usable: ["Latest usable", "Последний доступный", "So'nggi foydalanish mumkin"], v_inhub: ["Latest in the Hub", "Последний в хабе", "Hubdagi so'nggi"], v_used: ["Used in this nowcast", "Использовано в наукасте", "Naukastda ishlatilgan"],
  v_source: ["Hub dataset", "Набор в хабе", "Hub to'plami"], v_target: ["target", "цель", "maqsad"], v_predictor: ["predictor", "предиктор", "prediktor"],
  tr_pred: ["Nowcast", "Наукаст", "Naukast"], tr_err: ["Error", "Ошибка", "Xato"], tr_ar2: ["AR(2)", "AR(2)", "AR(2)"], tr_ar2err: ["AR(2) error", "Ошибка AR(2)", "AR(2) xatosi"],
  tr_summary: ["{n} quarters: RMSE {r} pp, MAE {m}, bias (actual − nowcast) {b}; RMSE ÷ AR(2) on the same quarters {x}.", "{n} кварталов: RMSE {r} п.п., MAE {m}, смещение (факт − наукаст) {b}; RMSE ÷ AR(2) на тех же кварталах {x}.", "{n} chorak: RMSE {r} f.p., MAE {m}, siljish (haqiqiy − naukast) {b}; bir xil choraklarda RMSE ÷ AR(2) {x}."],
  tr_dm: ["Diebold–Mariano test against AR(2): statistic {s}, one-sided p = {p} ({v}).", "Тест Диболда–Мариано против AR(2): статистика {s}, односторонний p = {p} ({v}).", "AR(2) ga qarshi Diebold–Mariano testi: statistika {s}, bir tomonlama p = {p} ({v})."],
  tr_dm_sig: ["significantly more accurate than AR(2)", "значимо точнее AR(2)", "AR(2) dan ahamiyatli darajada aniqroq"],
  tr_dm_not: ["not significantly more accurate than AR(2)", "не значимо точнее AR(2)", "AR(2) dan ahamiyatli darajada aniqroq emas"],
  // which model to trust
  trust_title: ["Which model to trust: real-time accuracy of every method", "Какой модели доверять: точность всех методов в реальном времени", "Qaysi modelga ishonish kerak: barcha usullarning real vaqtdagi aniqligi"],
  trust_note: ["Every quarter {a}–{b} was nowcast with only the data published by the stage's cut-off date. ÷ AR(2) below 1 = more accurate than the AR(2) benchmark on the same quarters. DM p: probability of an advantage this large by chance (Diebold–Mariano test with small-sample correction; below 0.10 = significant). With 18 quarters, small differences are not meaningful.", "Каждый квартал {a}–{b} оценён только по данным, опубликованным к дате этапа. ÷ AR(2) меньше 1 — точнее эталона AR(2) на тех же кварталах. p (DM): вероятность получить такое преимущество случайно (тест Диболда–Мариано с поправкой на малую выборку; меньше 0,10 — значимо). При 18 кварталах небольшие различия несущественны.", "{a}–{b} dagi har bir chorak faqat bosqich sanasigacha e'lon qilingan ma'lumotlar bilan baholangan. ÷ AR(2) 1 dan kichik — o'sha choraklarda AR(2) dan aniqroq. DM p: bunday ustunlik tasodifan chiqish ehtimoli (kichik tanlov tuzatishli Diebold–Mariano testi; 0,10 dan kichik — ahamiyatli). 18 chorakda kichik farqlar ahamiyatsiz."],
  trust_best: ["Most accurate in real time at stage {h}: {m}, RMSE {r} pp, {p}% below AR(2) on the same quarters (Diebold–Mariano p = {d}).", "Самая точная в реальном времени на этапе {h}: {m}, RMSE {r} п.п., на {p}% ниже AR(2) на тех же кварталах (p Диболда–Мариано = {d}).", "{h} bosqichida real vaqtda eng aniq: {m}, RMSE {r} f.p., o'sha choraklarda AR(2) dan {p}% past (Diebold–Mariano p = {d})."],
  trust_sig: ["Significantly better than AR(2) (p < 0.10): {l}.", "Значимо лучше AR(2) (p < 0,10): {l}.", "AR(2) dan ahamiyatli darajada yaxshi (p < 0,10): {l}."],
  trust_nosig: ["No model is significantly better than AR(2) at this stage (p < 0.10).", "Ни одна модель не лучше AR(2) значимо на этом этапе (p < 0,10).", "Bu bosqichda hech bir model AR(2) dan ahamiyatli darajada yaxshi emas (p < 0,10)."],
  trust_n: ["Quarters", "Кварталов", "Choraklar"], trust_all: ["÷ AR(2), all", "÷ AR(2), все", "÷ AR(2), hammasi"], trust_sel: ["÷ AR(2), selection", "÷ AR(2), выбор", "÷ AR(2), tanlash"],
  trust_test: ["÷ AR(2), test", "÷ AR(2), проверка", "÷ AR(2), tekshiruv"], trust_dm: ["DM p", "p (DM)", "DM p"],
  trust_exp: ["Experimental models are listed for comparison only; they are not candidates for the headline.", "Экспериментальные модели приведены только для сравнения и не претендуют на роль основного наукаста.", "Eksperimental modellar faqat taqqoslash uchun keltirilgan; ular asosiy naukastga nomzod emas."],
  // lab
  lab_intro: ["Build a model on the nowcasting panel (and any Hub series you add) and test it the same way as the Hub's models: pseudo-real-time, with release lags. Everything runs in your browser.", "Постройте модель на панели наукастинга (и любых добавленных рядах хаба) и проверьте её так же, как модели хаба: в псевдореальном времени, с учётом лагов публикации. Все расчёты выполняются в вашем браузере.", "Naukasting paneli (va Hubdan qo'shgan istalgan qator) asosida model tuzing va uni Hub modellari kabi sinab ko'ring: psevdo-real vaqtda, e'lon kechikishlari bilan. Hamma hisob-kitoblar brauzeringizda bajariladi."],
  lab_family: ["Model family", "Семейство моделей", "Model oilasi"],
  lab_form: ["Target", "Целевой показатель", "Maqsadli ko'rsatkich"],
  lab_form_auto: ["As in the Hub", "Как в Хабе", "Xabdagidek"],
  lab_form_quarter: ["Growth of the quarter alone, converted to year to date", "Рост отдельного квартала с пересчётом в рост с начала года", "Alohida chorak o'sishi, yil boshidan hisobga o'tkazilgan"],
  lab_form_ytd: ["Year-to-date growth as published", "Рост с начала года, как опубликован", "Yil boshidan o'sish, e'lon qilinganidek"],
  form_quarter: ["quarterly form", "квартальная форма", "choraklik shakl"],
  form_mixed: ["year-to-date and quarterly forms", "формы с начала года и квартальная", "yil boshidan va choraklik shakllar"],
  lab_predictors: ["Predictors", "Предикторы", "Prediktorlar"],
  lab_options: ["Options", "Параметры", "Parametrlar"],
  lab_eval: ["Evaluation", "Оценка", "Baholash"],
  lab_from: ["From", "С", "Dan"],
  lab_run: ["Run model", "Запустить модель", "Modelni ishga tushirish"],
  lab_running: ["Estimating… {m}", "Оценка… {m}", "Baholanmoqda… {m}"],
  lab_add: ["Add a Hub series", "Добавить ряд хаба", "Hub qatorini qo'shish"],
  lab_add_ph: ["Search a monthly dataset, e.g. cement, electricity, loans", "Найдите месячный набор, например цемент, электроэнергия, кредиты", "Oylik to'plamni qidiring, masalan sement, elektr energiyasi, kreditlar"],
  lab_transform: ["Transform", "Преобразование", "O'zgartirish"],
  lab_lag: ["Release lag, days", "Лаг публикации, дней", "E'lon kechikishi, kun"],
  lab_added: ["Added series", "Добавленные ряды", "Qo'shilgan qatorlar"],
  lab_result: ["Result", "Результат", "Natija"],
  lab_none: ["Choose a model family and predictors, then run.", "Выберите семейство моделей и предикторы, затем запустите.", "Model oilasi va prediktorlarni tanlang, keyin ishga tushiring."],
  lab_save: ["Add to report", "Добавить в отчёт", "Hisobotga qo'shish"],
  lab_saved: ["Added to the report builder", "Добавлено в конструктор отчётов", "Hisobot konstruktoriga qo'shildi"],
  lab_csv: ["Download forecasts (CSV)", "Скачать прогнозы (CSV)", "Prognozlarni yuklab olish (CSV)"],
  lab_coef: ["Coefficients", "Коэффициенты", "Koeffitsiyentlar"],
  lab_acc: ["Accuracy vs AR(2)", "Точность относительно AR(2)", "AR(2) ga nisbatan aniqlik"],
  lab_chart: ["Actual and pseudo-real-time forecasts at {h}", "Факт и прогнозы в псевдореальном времени на этапе {h}", "{h} bosqichida haqiqiy qiymat va prognozlar"],
  lab_failure: ["The model could not produce a nowcast: {f}", "Модель не смогла дать наукаст: {f}", "Model naukast bera olmadi: {f}"],
  lab_ai: ["Describe a model", "Опишите модель", "Modelni tasvirlang"],
  lab_win_main: ["Evaluation window {a}–{b}", "Окно оценки {a}–{b}", "Baholash oynasi {a}–{b}"],
  lab_exp_title: ["Experimental models", "Экспериментальные модели", "Eksperimental modellar"],
  lab_exp_intro: ["Models on trial. The fortnightly run re-estimates them with every other model, and each time SIAT publishes a GDP quarter that quarter is added to their comparison with the same model without the new data. They stay out of every combination and the headline until they are reviewed.", "Модели на испытании. Плановый расчёт переоценивает их вместе с остальными моделями, и после каждой публикации квартального ВВП этот квартал добавляется в их сравнение с той же моделью без новых данных. До пересмотра они не входят ни в комбинации, ни в основной наукаст.", "Sinovdagi modellar. Rejali hisob ularni boshqa barcha modellar bilan birga qayta baholaydi, Statistika agentligi har safar choraklik YaIMni e'lon qilganda esa shu chorak ularning yangi ma'lumotsiz xuddi shu model bilan taqqoslashiga qo'shiladi. Ko'rib chiqilgunga qadar ular kombinatsiyalar va asosiy naukast tarkibiga kirmaydi."],
  lab_exp_added: ["Added {d} · compared with: {b} · trial window from {t}: {n} of {r} quarters scored", "Добавлена {d} · сравнивается с: {b} · испытательный период с {t}: оценено {n} из {r} кварталов", "Qo'shilgan sana: {d} · taqqoslanadi: {b} · sinov davri {t} dan: {r} chorakdan {n} tasi baholangan"],
  lab_exp_base: ["Without the new data", "Без новых данных", "Yangi ma'lumotsiz"],
  lab_exp_latest: ["Latest scored quarter {q} (standard lags), error actual − nowcast: {e}; without the new data: {b}", "Последний оценённый квартал {q} (стандартные лаги), ошибка факт − наукаст: {e}; без новых данных: {b}", "So'nggi baholangan chorak {q} (standart kechikish), xato haqiqiy − naukast: {e}; yangi ma'lumotsiz: {b}"],
  lab_exp_base_rmse: ["RMSE without", "RMSE без", "RMSE ularsiz"],
  lab_exp_ratio: ["Ratio", "Отношение", "Nisbat"],
  lab_exp_better: ["Closer to actual", "Ближе к факту", "Haqiqatga yaqinroq"],
  lab_exp_empty: ["No quarter of the trial window is published yet; the first, {q}, is due about 31 days after the quarter ends.", "Ни один квартал испытательного периода ещё не опубликован; первый, {q}, ожидается примерно через 31 день после окончания квартала.", "Sinov davrining birorta choragi hali e'lon qilinmagan; birinchisi, {q}, chorak tugaganidan taxminan 31 kun o'tib kutiladi."],
  lab_exp_run: ["Run it in the lab", "Запустить в лаборатории", "Laboratoriyada ishga tushirish"],
  lab_exp_cmp: ["Comparison with {b} on the same quarters", "Сравнение с моделью «{b}» на тех же кварталах", "Xuddi shu choraklarda «{b}» bilan taqqoslash"],
  lab_exp_rule: ["Re-test rule and evidence (English)", "Правило перепроверки и обоснование (англ.)", "Qayta tekshirish qoidasi va asos (ingliz tilida)"],
  lab_exp_chart: ["Official GDP growth and nowcasts at {h} (standard lags)", "Официальный рост ВВП и наукасты этапа {h} (стандартные лаги)", "Rasmiy YaIM o'sishi va {h} bosqichidagi naukastlar (standart kechikish)"],
  lab_ai_ph: ["For example: a bridge equation for GDP with industrial production, retail trade and imports, compared with the headline; or a BVAR with M2 and the exchange rate; or a new model that uses cement production from the Hub.", "Например: бридж-уравнение ВВП по промышленности, рознице и импорту в сравнении с основным прогнозом; BVAR с M2 и курсом; или новая модель с производством цемента из хаба.", "Masalan: sanoat, chakana savdo va import bilan YaIM uchun ko'prik tenglamasi, asosiy prognoz bilan taqqoslab; M2 va kurs bilan BVAR; yoki Hubdagi sement ishlab chiqarishidan foydalanadigan yangi model."],
  lab_ai_btn: ["Build with Claude", "Построить с Claude", "Claude bilan tuzish"],
  lab_ai_note: ["Claude designs the model and runs it with the lab's estimators; the numbers come from the lab, not from the AI. Uses your Claude account.", "Claude проектирует модель и запускает её оценщиками лаборатории; цифры считает лаборатория, а не ИИ. Использует ваш аккаунт Claude.", "Claude modelni loyihalaydi va laboratoriya baholagichlari bilan ishga tushiradi; raqamlarni laboratoriya hisoblaydi, sun'iy intellekt emas. Claude hisobingizdan foydalanadi."],
  in_claude: ["Open in Claude ↗", "Открыть в Claude ↗", "Claude'da ochish ↗"],
  lab_ai_native: ["Claude can design and run models here when the hub is opened on claude.ai (needs a Claude account).", "Claude может проектировать и запускать модели, когда хаб открыт на claude.ai (нужен аккаунт Claude).", "Hub claude.ai'da ochilganda Claude bu yerda modellarni loyihalab, ishga tushira oladi (Claude hisobi kerak)."],
  rep_ai_native: ["Text written by Claude is available when the hub is opened on claude.ai (needs a Claude account). Here the report uses template text; numbers, tables and charts are the same.", "Текст, написанный Claude, доступен, когда хаб открыт на claude.ai (нужен аккаунт Claude). Здесь отчёт использует шаблонный текст; цифры, таблицы и графики те же.", "Claude yozgan matn hub claude.ai'da ochilganda mavjud (Claude hisobi kerak). Bu yerda hisobot shablon matndan foydalanadi; raqamlar, jadvallar va grafiklar bir xil."],
  lab_ai_off: ["Claude is not available in this view.", "Claude недоступен в этом представлении.", "Bu ko'rinishda Claude mavjud emas."],
  stop: ["Stop", "Стоп", "To'xtatish"],
  thinking: ["Thinking…", "Думаю…", "O'ylamoqda…"],
  // reports
  rep_intro: ["Assemble a report from the nowcast, the models and any Hub data. Charts and tables are built in your browser; Claude only writes the text (or choose template text, which uses no credits).", "Соберите отчёт из наукаста, моделей и данных хаба. Графики и таблицы строятся в браузере; Claude пишет только текст (или выберите шаблонный текст — без затрат кредитов).", "Naukast, modellar va Hub ma'lumotlaridan hisobot tuzing. Grafiklar va jadvallar brauzeringizda quriladi; Claude faqat matnni yozadi (yoki kreditsiz shablon matnni tanlang)."],
  rep_title: ["Title", "Заголовок", "Sarlavha"],
  rep_lang: ["Language", "Язык", "Til"],
  rep_length: ["Length", "Объём", "Hajm"],
  len_brief: ["Brief (1 page)", "Кратко (1 стр.)", "Qisqa (1 bet)"], len_standard: ["Standard (3–4 pages)", "Стандарт (3–4 стр.)", "Standart (3–4 bet)"], len_full: ["Full (8–10 pages)", "Полный (8–10 стр.)", "To'liq (8–10 bet)"],
  rep_audience: ["Audience", "Аудитория", "Auditoriya"],
  aud_policy: ["Policy brief", "Для руководства", "Rahbariyat uchun"], aud_technical: ["Technical report", "Технический отчёт", "Texnik hisobot"],
  rep_topics: ["Topics", "Темы", "Mavzular"],
  rep_models: ["Models", "Модели", "Modellar"],
  rep_charts: ["Charts", "Графики", "Grafiklar"],
  rep_text: ["Text", "Текст", "Matn"],
  text_ai: ["Written by Claude", "Пишет Claude", "Claude yozadi"], text_tpl: ["Template text (no credits)", "Шаблонный текст (без кредитов)", "Shablon matn (kreditsiz)"],
  style_line: ["Lines", "Линии", "Chiziqlar"], style_bar: ["Bars", "Столбцы", "Ustunlar"],
  rep_tables: ["Include tables", "Включить таблицы", "Jadvallarni kiritish"],
  rep_go: ["Build report", "Собрать отчёт", "Hisobotni tuzish"],
  rep_dl_html: ["Download HTML", "Скачать HTML", "HTML yuklab olish"],
  rep_dl_md: ["Download Markdown", "Скачать Markdown", "Markdown yuklab olish"],
  rep_print: ["Print or save as PDF", "Печать или PDF", "Chop etish yoki PDF"],
  rep_building: ["Building the report…", "Собираю отчёт…", "Hisobot tuzilmoqda…"],
  rep_writing: ["Claude is writing the text…", "Claude пишет текст…", "Claude matn yozmoqda…"],
  rep_done: ["Report ready", "Отчёт готов", "Hisobot tayyor"],
  rep_lab_runs: ["Your lab runs", "Ваши расчёты в лаборатории", "Laboratoriyadagi hisoblaringiz"],
  rep_no_runs: ["None yet: use “Add to report” in the model lab.", "Пока нет: используйте «Добавить в отчёт» в лаборатории.", "Hali yo'q: laboratoriyada “Hisobotga qo'shish” tugmasidan foydalaning."],
  // data
  avail: ["Data availability at {d}", "Доступность данных на {d}", "{d} holatiga ma'lumotlar mavjudligi"],
  indicator: ["Indicator", "Индикатор", "Ko'rsatkich"],
  latest_usable: ["Latest usable", "Последний доступный", "So'nggi foydalanish mumkin"],
  in_hub: ["Latest in Hub", "Последний в хабе", "Hubdagi so'nggi"],
  lag_days: ["Lag, days", "Лаг, дней", "Kechikish, kun"],
  status: ["Status", "Статус", "Holat"],
  registry: ["The {n} nowcasting variables and where they come from", "{n} переменных наукастинга и их источники", "{n} ta naukasting o'zgaruvchisi va ularning manbalari"],
  hub_dataset: ["Hub dataset", "Набор в хабе", "Hub to'plami"],
  transform: ["Transform", "Преобразование", "O'zgartirish"],
  candidates: ["More Hub indicators for nowcasting (not in any model yet)", "Другие индикаторы хаба для наукастинга (пока не в моделях)", "Naukasting uchun Hubdagi boshqa ko'rsatkichlar (hali modellarda emas)"],
  analysis: ["How the Hub changes the data work", "Что хаб меняет в работе с данными", "Hub ma'lumotlar bilan ishlashni qanday o'zgartiradi"],
  open: ["Open", "Открыть", "Ochish"],
  rep_chart_models: ["Models in the nowcast chart", "Модели на графике наукаста", "Naukast grafigidagi modellar"]
};
function uzc(s) {   // Uzbek Latin -> Cyrillic for interface text
  var map = [["YaIM", "ЯИМ"], ["O'", "Ў"], ["o'", "ў"], ["G'", "Ғ"], ["g'", "ғ"], ["Sh", "Ш"], ["sh", "ш"], ["Ch", "Ч"], ["ch", "ч"], ["Yo", "Ё"], ["yo", "ё"], ["Yu", "Ю"], ["yu", "ю"], ["Ya", "Я"], ["ya", "я"], ["Ye", "Е"], ["ye", "е"]];
  var single = { a: "а", b: "б", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з" };
  var out = "", i = 0, str = String(s).replace(/[‘’ʻʼ]/g, "'");
  var skip = /\{[a-z]+\}|\d{4}Q[1-4]|H[123]|AR\(\d\)|U-MIDAS|MIDAS|BVAR|DFM|USD\/UZS|RMSE|GDP|CSV|HTML|PDF|Markdown|Claude|Hub|Lasso|[A-Z]{2,}[\w./-]*/y;
  while (i < str.length) {
    skip.lastIndex = i; var sk = skip.exec(str);
    if (sk) { out += sk[0]; i += sk[0].length; continue; }
    var done = false;
    for (var k = 0; k < map.length; k++) { var a = map[k][0]; if (str.substr(i, a.length) === a) { out += map[k][1]; i += a.length; done = true; break; } }
    if (done) continue;
    var c = str[i], lc = c.toLowerCase(), m = single[lc];
    if (m) { var prevLetter = i > 0 && /[A-Za-zА-Яа-яЎўҒғҚқҲҳЁё]/.test(str[i - 1]); if (lc === "e" && !prevLetter) m = "э"; out += c === lc ? m : m.toUpperCase(); }
    else if (c === "'") out += "ъ"; else out += c;
    i++;
  }
  return out;
}
function tr(key, vars) {
  var a = NT[key], li = H.L(), s;
  if (!a) s = key; else if (li === 3) s = uzc(a[2] || a[0]); else s = a[li] || a[0];
  if (vars) for (var k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}
function roleText(r) { return r && NT["role_" + r] ? tr("role_" + r) : (r || ""); }
function nf(v, d) { return v == null || isNaN(v) ? "–" : H.nf(v, d == null ? 2 : d); }
function pct(v, d) { return v == null || isNaN(v) ? "–" : H.nf(v, d == null ? 2 : d) + "%"; }
function fmtDate(s) { if (!s) return "–"; try { return new Date(String(s).slice(0, 10) + "T12:00:00Z").toLocaleDateString(({ en: "en-GB", ru: "ru-RU", uz: "uz-Latn-UZ", uzc: "uz-Cyrl-UZ" })[H.state.lang] || "en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return s; } }
function fmtMonth(s) { if (!s) return "–"; try { return new Date(String(s).slice(0, 7) + "-15T12:00:00Z").toLocaleDateString(({ en: "en-GB", ru: "ru-RU", uz: "uz-Latn-UZ", uzc: "uz-Cyrl-UZ" })[H.state.lang] || "en-GB", { month: "long", year: "numeric" }); } catch (e) { return s; } }

/* ---------------- loading ---------------- */
function load() {
  if (NC && PANEL) return Promise.resolve();
  if (!LOADING) LOADING = Promise.all([H.getJSON("data/nowcast.json"), H.getJSON("data/nowcast_panel.json")]).then(function (r) { NC = r[0]; PANEL = r[1]; buildLabels(); }, function (e) { LOADING = null; throw e; });
  return LOADING;
}
function loadEcon() {
  if (ECON) return Promise.resolve(ECON);
  if (window.Econ) { ECON = window.Econ; return Promise.resolve(ECON); }
  if (!ECON_LOADING) ECON_LOADING = new Promise(function (res, rej) {
    var s = document.createElement("script"); s.src = "lib/econ.js";
    s.onload = function () { ECON = window.Econ; ECON ? res(ECON) : rej(new Error("econ.js did not load")); };
    s.onerror = function () { ECON_LOADING = null; rej(new Error("econ.js could not be loaded")); };
    document.head.appendChild(s);
  });
  return ECON_LOADING;
}
var LABEL = {}, FAMILY = {}, ROLE = {}, FORM = {}, SHORT = {};
function buildLabels() {
  (NC.experimental || []).forEach(function (x) { if (x.short_label) SHORT[x.model] = x.short_label; });
  (NC.accuracy.rows || []).forEach(function (r) { LABEL[r[0]] = r[1]; FAMILY[r[0]] = r[2]; ROLE[r[0]] = r[3]; });
  (NC.models || []).forEach(function (r) { LABEL[r.model] = r.label; FAMILY[r.model] = r.family_name || r.family; ROLE[r.model] = r.role; FORM[r.model] = r.form; });
  (NC.single_indicator || []).forEach(function (r) { LABEL[r.model] = r.label; ROLE[r.model] = ROLE[r.model] || "single"; FORM[r.model] = r.form; });
}
/* Family of a model plus its target form when it is not the published year-to-date growth. */
function famLine(m, fam) {
  var f = FORM[m], t = f === "quarter" ? tr("form_quarter") : f === "mixed" ? tr("form_mixed") : "";
  var base = fam != null ? fam : (FAMILY[m] || "");
  return base + (t ? (base ? " · " : "") + t : "");
}
function label(m) { return LABEL[m] || m; }
function shortLabel(m) { return SHORT[m] || label(m); }
function isExp(m) { return ROLE[m] === "experimental"; }
/* The panel's training-window rule (nowcast_panel.json release_rule.training). */
function trainingRule() { return (PANEL && PANEL.release_rule && PANEL.release_rule.training) || {}; }
function recordFirst() { return trainingRule().record_first || "2018Q1"; }
function prevQuarter(q) { var y = +String(q).slice(0, 4), k = +String(q).slice(5); return k === 1 ? (y - 1) + "Q4" : y + "Q" + (k - 1); }
function headlineId() { return NC.headline.model; }
function isHeadline(m) { return m === NC.headline.model; }
function modelRow(m) { var x = null; (NC.models || []).forEach(function (r) { if (r.model === m) x = r; }); return x; }
function varByField(f) { var v = null; (PANEL.variables || []).forEach(function (x) { if (x.field === f) v = x; }); return v; }
function currentValue(model, lag) {
  var cons = lag === "conservative", hd = NC.headline, r = modelRow(model);
  if (model === hd.model) return cons ? hd.conservative_value : hd.value;
  if (r) return cons ? r.conservative_value : r.value;
  if (!cons) { var v = null; (NC.single_indicator || []).forEach(function (x) { if (x.model === model) v = x.value; }); return v; }
  return null;
}
/* Models with stored predictions (for the charts), headline first. */
function chartModels() {
  var seen = {}, out = [];
  [NC.headline.model].concat((NC.models || []).map(function (r) { return r.model; })).forEach(function (m) { if (!seen[m]) { seen[m] = 1; out.push(m); } });
  return out;
}
/* ---------------- model picker for charts ---------------- */
var PICK_KEY = "uzdh-nc-pick-v2", PICK = null;   // v2: the 7 October 2026 headline (older stored picks did not include it)
function pickStore() {
  if (PICK) return PICK;
  try { PICK = JSON.parse(localStorage.getItem(PICK_KEY) || "{}") || {}; } catch (e) { PICK = {}; }
  return PICK;
}
function pickSave() { try { localStorage.setItem(PICK_KEY, JSON.stringify(PICK || {})); } catch (e) {} }
function picked(id, avail, dflt) {
  var st = pickStore()[id];
  var list = Array.isArray(st) ? st.filter(function (m) { return avail.indexOf(m) >= 0; }) : dflt.filter(function (m) { return avail.indexOf(m) >= 0; });
  return list;
}
/* A collapsible list of checkboxes, grouped by role. onChange(list) redraws the chart. */
function pickerHTML(id, avail, sel) {
  var groups = [["headline", "cg_headline"], ["benchmark", "cg_benchmarks"], ["model", "cg_models"], ["experimental", "cg_experimental"], ["combination", "cg_combinations"], ["single", "cg_single"]];
  var h = '<details class="mpick" data-pick="' + esc(id) + '"><summary>' + esc(tr("pick")) + ' <span class="muted">(' + sel.length + "/" + avail.length + ')</span></summary><div class="mpick-panel"><p class="muted">' + esc(tr("pick_note")) + "</p>";
  groups.forEach(function (g) {
    var ms = avail.filter(function (m) { return (isHeadline(m) ? "headline" : (ROLE[m] || "model")) === g[0]; });
    if (!ms.length) return;
    h += "<div><b>" + esc(tr(g[1])) + "</b>" + ms.map(function (m) { return '<label><input type="checkbox" value="' + esc(m) + '"' + (sel.indexOf(m) >= 0 ? " checked" : "") + "> " + esc(label(m)) + "</label>"; }).join("") + "</div>";
  });
  h += '<div class="mpick-row"><button class="linkbtn" data-pick-act="default">' + esc(tr("pick_default")) + '</button><button class="linkbtn" data-pick-act="clear">' + esc(tr("pick_clear")) + "</button></div></div></details>";
  return h;
}
function bindPicker(root, id, avail, dflt, redraw) {
  var box = root.querySelector('[data-pick="' + id + '"]'); if (!box) return;
  function cur() { return Array.prototype.map.call(box.querySelectorAll("input:checked"), function (x) { return x.value; }); }
  function set(list) { pickStore()[id] = list; pickSave(); var c = box.querySelector("summary .muted"); if (c) c.textContent = "(" + list.length + "/" + avail.length + ")"; redraw(list); }
  Array.prototype.forEach.call(box.querySelectorAll("input"), function (x) { x.onchange = function () { set(cur()); }; });
  Array.prototype.forEach.call(box.querySelectorAll("[data-pick-act]"), function (b) {
    b.onclick = function (ev) {
      ev.preventDefault();
      var list = b.getAttribute("data-pick-act") === "default" ? dflt.filter(function (m) { return avail.indexOf(m) >= 0; }) : [];
      Array.prototype.forEach.call(box.querySelectorAll("input"), function (x) { x.checked = list.indexOf(x.value) >= 0; });
      if (b.getAttribute("data-pick-act") === "default") { delete pickStore()[id]; pickSave(); var c = box.querySelector("summary .muted"); if (c) c.textContent = "(" + list.length + "/" + avail.length + ")"; redraw(list); }
      else set(list);
    };
  });
}
/* Stable colours: the headline and the main models keep theirs whichever models are shown. */
var MODEL_COLOR = { prod_v2_combination: 1, prod_v2_dfm: 6, prod_v2_umidas: 2, bu_kalman_combination: 4, ytd_combination: 5, ar2: 3, ensemble_ar2_umidas_usd: 7 };
function colorFor(m, i) { return MODEL_COLOR[m] != null ? MODEL_COLOR[m] : (i % 7) + 1; }

/* ---------------- charts ---------------- */
var PAL = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"];
var PAL_HEX = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
function colorOf(i, fixed) { return fixed ? PAL_HEX[i % 8] : "var(" + PAL[i % 8] + ")"; }
/* Line chart. opts: {labels, series:[{name, values, dash, width, marker}], band?:{lo,hi}, unit, fixed (hex colours for reports), height, bars} */
function lineChart(opts) {
  var labels = opts.labels, W = opts.width || 720, Hh = opts.height || Math.round(Math.min(340, Math.max(220, W * 0.42)));
  var padL = 52, padR = 16, padT = 14, padB = 30, fixed = !!opts.fixed;
  var vals = [];
  opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && !isNaN(v)) vals.push(v); }); });
  if (opts.band) opts.band.lo.concat(opts.band.hi).forEach(function (v) { if (v != null && !isNaN(v)) vals.push(v); });
  if (opts.ref != null) vals.push(opts.ref);
  if (!vals.length) return '<p class="muted">–</p>';
  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  if (opts.bars) { mn = Math.min(0, mn); mx = Math.max(0, mx); }
  var ticks = H.niceTicks(mn, mx, 5), y0 = ticks[0], y1 = ticks[ticks.length - 1], n = labels.length, pw = W - padL - padR, ph = Hh - padT - padB;
  var grid = fixed ? "#e1e6e7" : "var(--grid)", muted = fixed ? "#5f707a" : "var(--muted)", rule = fixed ? "#a9b8bd" : "var(--rule-strong)";
  var banded = opts.bars || n <= 6;   // few points: centre them in equal bands so edge labels stay inside
  function X(k) { return banded ? padL + (k + 0.5) * pw / n : padL + (n === 1 ? pw / 2 : k * pw / (n - 1)); }
  function Y(v) { return padT + ph - (v - y0) / ((y1 - y0) || 1) * ph; }
  var svg = '<svg viewBox="0 0 ' + W + " " + Hh + '" xmlns="http://www.w3.org/2000/svg" role="img" font-family="IBM Plex Sans, Arial, sans-serif">';
  ticks.forEach(function (tv) { var y = Y(tv); svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="' + grid + '"/><text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="' + muted + '">' + esc(H.nf(tv, Math.abs(y1 - y0) < 5 ? 1 : 0)) + "</text>"; });
  var nt = Math.min(n, Math.max(2, Math.floor(pw / 70))), lastX = -1e9;
  for (var q = 0; q < nt; q++) { var k = Math.round(q * (n - 1) / Math.max(1, nt - 1)), x = X(k); if (x - lastX < 56) continue; lastX = x; var anc = banded ? "middle" : q === 0 ? "start" : q === nt - 1 ? "end" : "middle"; svg += '<text x="' + x + '" y="' + (Hh - 9) + '" text-anchor="' + anc + '" font-size="11" fill="' + muted + '">' + esc(labels[k]) + "</text>"; }
  if (opts.band) {
    var up = [], dn = [];
    for (var b = 0; b < n; b++) { if (opts.band.lo[b] != null && opts.band.hi[b] != null) { up.push(X(b).toFixed(1) + "," + Y(opts.band.hi[b]).toFixed(1)); dn.unshift(X(b).toFixed(1) + "," + Y(opts.band.lo[b]).toFixed(1)); } }
    if (up.length) svg += '<path d="M' + up.join("L") + "L" + dn.join("L") + 'Z" fill="' + (fixed ? "#2a78d6" : "var(--c1)") + '" opacity="0.14"/>';
  }
  if (opts.ref != null) { var yr = Y(opts.ref); svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yr + '" y2="' + yr + '" stroke="' + rule + '" stroke-dasharray="4 4"/>'; }
  if (opts.bars) {
    var ns = opts.series.length, bw = Math.max(3, pw / n / (ns + 1));
    opts.series.forEach(function (s, si) {
      s.values.forEach(function (v, k) { if (v == null || isNaN(v)) return; var x = X(k) - (ns * bw) / 2 + si * bw, ya = Y(Math.max(0, v)), yb = Y(Math.min(0, v)); svg += '<rect x="' + x.toFixed(1) + '" y="' + ya.toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + Math.max(1, yb - ya).toFixed(1) + '" fill="' + colorOf(s.color == null ? si : s.color, fixed) + '"/>'; });
    });
  } else {
    opts.series.forEach(function (s, si) {
      var seg = "", pts = [], dots = "", col = colorOf(s.color == null ? si : s.color, fixed);
      for (var k = 0; k < n; k++) { var v = s.values[k]; if (v == null || isNaN(v)) { if (pts.length) { seg += "M" + pts.join("L"); pts = []; } continue; } pts.push(X(k).toFixed(1) + "," + Y(v).toFixed(1)); if (s.marker || n <= 12) dots += '<circle cx="' + X(k).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (s.width > 2 ? 3.5 : 2.8) + '" fill="' + col + '"/>'; }
      if (pts.length) seg += "M" + pts.join("L");
      svg += '<path d="' + seg + '" fill="none" stroke="' + col + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : "") + "/>" + dots;
    });
  }
  svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + ph) + '" y2="' + (padT + ph) + '" stroke="' + rule + '"/>';
  if (!fixed) svg += '<rect class="hit" x="' + padL + '" y="' + padT + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
  svg += "</svg>";
  return svg;
}
function legendHTML(series, fixed) { return '<div class="legend">' + series.map(function (s, si) { return '<span><i style="background:' + colorOf(s.color == null ? si : s.color, fixed) + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>"; }
function attachTip(box, opts) {
  var svg = box.querySelector("svg"), hit = box.querySelector(".hit"); if (!svg || !hit) return;
  var tip = H.tip(), W = opts.width || 720, n = opts.labels.length, padL = 52, padR = 16, pw = W - padL - padR;
  hit.addEventListener("pointermove", function (ev) {
    var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width;
    var k = (opts.bars || n <= 6) ? Math.floor((sx - padL) / pw * n) : Math.round((sx - padL) / pw * (n - 1)); k = Math.max(0, Math.min(n - 1, k));
    var hh = "<b>" + esc(opts.labels[k]) + "</b>";
    opts.series.forEach(function (s, si) { var v = s.values[k]; if (v == null || isNaN(v)) return; hh += '<div class="tr"><i style="background:' + colorOf(s.color == null ? si : s.color) + '"></i><span>' + esc(s.name) + ": <b>" + esc(nf(v)) + "</b></span></div>"; });
    if (opts.band && opts.band.lo[k] != null) hh += '<div class="tr"><span>' + esc(nf(opts.band.lo[k])) + " – " + esc(nf(opts.band.hi[k])) + "</span></div>";
    tip.innerHTML = hh; tip.hidden = false;
    var tx = ev.clientX + 14, ty = ev.clientY + 14, tr2 = tip.getBoundingClientRect();
    if (tx + tr2.width > innerWidth - 8) tx = ev.clientX - tr2.width - 14;
    if (ty + tr2.height > innerHeight - 8) ty = ev.clientY - tr2.height - 14;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  });
  hit.addEventListener("pointerleave", function () { tip.hidden = true; });
}
function drawLine(boxId, opts) {
  var box = document.getElementById(boxId); if (!box) return;
  opts.width = Math.max(320, box.clientWidth || 720);
  box.innerHTML = lineChart(opts);
  attachTip(box, opts);
}
/* Dot plot: items [{label, value, band68, band90, strong}], ref {value, label} */
function dotPlot(items, ref, fixed, width) {
  var W = width || 720, stacked = W < 560, rowH = stacked ? 40 : 26, padL = stacked ? 12 : Math.min(300, Math.max(160, W * 0.36)), padR = 20, padT = 10, Hh = padT + items.length * rowH + 30;
  var vals = []; items.forEach(function (it) { if (it.value != null) vals.push(it.value); if (it.band90) vals.push(it.band90[0], it.band90[1]); });
  if (ref && ref.value != null) vals.push(ref.value);
  if (!vals.length) return "";
  var ticks = H.niceTicks(Math.min.apply(null, vals), Math.max.apply(null, vals), 5), x0 = ticks[0], x1 = ticks[ticks.length - 1], pw = W - padL - padR;
  function X(v) { return padL + (v - x0) / ((x1 - x0) || 1) * pw; }
  var ink = fixed ? "#132129" : "var(--ink)", muted = fixed ? "#5f707a" : "var(--muted)", grid = fixed ? "#e1e6e7" : "var(--grid)", c1 = fixed ? "#2a78d6" : "var(--c1)", c2 = fixed ? "#eb6834" : "var(--c2)";
  var svg = '<svg viewBox="0 0 ' + W + " " + Hh + '" xmlns="http://www.w3.org/2000/svg" role="img" font-family="IBM Plex Sans, Arial, sans-serif">';
  ticks.forEach(function (tv) { var x = X(tv); svg += '<line x1="' + x + '" x2="' + x + '" y1="' + padT + '" y2="' + (Hh - 24) + '" stroke="' + grid + '"/><text x="' + x + '" y="' + (Hh - 8) + '" text-anchor="middle" font-size="11" fill="' + muted + '">' + esc(H.nf(tv, 1)) + "</text>"; });
  if (ref && ref.value != null) { var xr = X(ref.value); svg += '<line x1="' + xr + '" x2="' + xr + '" y1="' + padT + '" y2="' + (Hh - 24) + '" stroke="' + c2 + '" stroke-width="2" stroke-dasharray="5 4"/>'; }
  items.forEach(function (it, i) {
    var y = padT + i * rowH + (stacked ? 28 : rowH / 2);
    if (stacked) svg += '<text x="' + padL + '" y="' + (y - 12) + '" font-size="12" fill="' + (it.strong ? ink : muted) + '"' + (it.strong ? ' font-weight="600"' : "") + ">" + esc(it.label) + "</text>";
    else svg += '<text x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end" font-size="12" fill="' + (it.strong ? ink : muted) + '"' + (it.strong ? ' font-weight="600"' : "") + ">" + esc(it.label.length > 44 ? it.label.slice(0, 43) + "…" : it.label) + "</text>";
    if (it.band90) svg += '<line x1="' + X(it.band90[0]) + '" x2="' + X(it.band90[1]) + '" y1="' + y + '" y2="' + y + '" stroke="' + c1 + '" stroke-width="2" opacity="0.4"/>';
    if (it.band68) svg += '<line x1="' + X(it.band68[0]) + '" x2="' + X(it.band68[1]) + '" y1="' + y + '" y2="' + y + '" stroke="' + c1 + '" stroke-width="5" opacity="0.5"/>';
    if (it.value != null) svg += '<circle cx="' + X(it.value) + '" cy="' + y + '" r="' + (it.strong ? 6 : 4.5) + '" fill="' + (it.strong ? c2 : c1) + '"/><text x="' + (X(it.value) + 9) + '" y="' + (y + (stacked ? 4 : -7)) + '" font-size="10.5" fill="' + muted + '">' + esc(H.nf(it.value, 2)) + "</text>";
  });
  return svg + "</svg>";
}

/* ---------------- shell ---------------- */
function render() {
  var el = document.getElementById("view-nowcast");
  if (!NC) {
    el.innerHTML = "<h2>" + esc(tr("title")) + '</h2><p class="muted">' + esc(tr("loading")) + "</p>";
    load().then(render, function (e) { el.innerHTML = "<h2>" + esc(tr("title")) + '</h2><p class="note">' + esc(tr("load_err", { e: e.message })) + "</p>"; });
    return;
  }
  var nav = '<nav class="ncnav" aria-label="Nowcast">' + SUBS.map(function (s) { return '<button data-sub="' + s + '" aria-pressed="' + (S.sub === s) + '">' + esc(tr("s_" + s)) + "</button>"; }).join("") + "</nav>";
  el.innerHTML = nav + '<div id="nc-body" class="ncbody"></div>';
  Array.prototype.forEach.call(el.querySelectorAll("[data-sub]"), function (b) { b.onclick = function () { go(b.getAttribute("data-sub")); }; });
  ({ overview: renderOverview, accuracy: renderAccuracy, calc: renderCalc, lab: renderLab, reports: renderReports, data: renderData, method: renderMethod })[S.sub]();
}
/* sub: "overview" | "accuracy" | … | "calc" (index) | "calc/<model>[/<quarter>/<stage>/<lags>]" | "calc/lab" (model-lab spec) */
function go(sub) {
  var parts = String(sub || "overview").split("/"), s = parts[0], c = S.calc;
  if (s === "calc") {
    if (parts[1] === "lab") { if (!c.spec) c.model = null; }
    else if (parts[1]) { c.spec = null; c.model = decodeURIComponent(parts[1]); c.q = parts[2] || c.q; c.h = parts[3] || c.h; c.lag = parts[4] || c.lag; }
    else { c.model = null; c.spec = null; }
  }
  S.sub = SUBS.indexOf(s) >= 0 ? s : "overview";
  try { history.replaceState(null, "", "#nowcast" + (S.sub === "overview" ? "" : "/" + (S.sub === "calc" ? calcPath() : S.sub))); } catch (e) {}
  render();
  var top = document.getElementById("view-nowcast"); if (top && top.scrollIntoView && window.scrollY > top.offsetTop) top.scrollIntoView({ block: "start" });
}
function calcPath() {
  var c = S.calc;
  if (!c.model) return "calc";
  if (c.spec) return "calc/lab";
  return "calc/" + encodeURIComponent(c.model) + (c.q ? "/" + c.q + "/" + c.h + "/" + c.lag : "");
}
/* Open the calculations of a model. o: {q, h, lag, spec} (defaults: the production origin). */
function openCalc(model, o) {
  o = o || {};
  var c = S.calc;
  if (S.sub !== "calc") c.from = S.sub;
  c.model = model; c.spec = o.spec || null;
  c.q = o.q || NC.target.quarter; c.h = o.h && o.h !== "pooled" ? o.h : NC.target.stage; c.lag = o.lag || "standard";
  if (c.q === NC.target.quarter && c.h > NC.target.stage) c.h = NC.target.stage;
  go(c.spec ? "calc/lab" : "calc/" + encodeURIComponent(model) + "/" + c.q + "/" + c.h + "/" + c.lag);
}
function calcButton(model, o) {
  o = o || {};
  return '<button class="calcbtn" data-calc="' + esc(model) + '"' + (o.h ? ' data-h="' + esc(o.h) + '"' : "") + (o.lag ? ' data-lag="' + esc(o.lag) + '"' : "") + (o.q ? ' data-q="' + esc(o.q) + '"' : "") + ' title="' + esc(tr("calc_btn") + ": " + label(model)) + '">ƒx ' + esc(o.text || tr("calc_btn")) + "</button>";
}
function bindCalc(root) {
  Array.prototype.forEach.call(root.querySelectorAll("[data-calc]"), function (b) {
    b.onclick = function (ev) { ev.stopPropagation(); openCalc(b.getAttribute("data-calc"), { h: b.getAttribute("data-h"), lag: b.getAttribute("data-lag"), q: b.getAttribute("data-q") }); };
  });
}
function body() { return document.getElementById("nc-body"); }
function seg(name, cur, opts) { return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === cur) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>"; }
function bindSeg(root, name, fn) { var s = root.querySelector('[data-seg="' + name + '"]'); if (!s) return; Array.prototype.forEach.call(s.querySelectorAll("button"), function (b) { b.onclick = function () { fn(b.getAttribute("data-v")); }; }); }

/* ---------------- overview ---------------- */
function hlAcc(m, hz, win) { var x = {}; (NC.headline.accuracy || []).forEach(function (a) { if (a.model === m && a.horizon === hz && a.window === (win || "all")) x = a; }); return x; }
function winSpan(w) { var q = (NC.accuracy.windows || {})[w] || []; return q.length ? [q[0], q[q.length - 1]] : ["", ""]; }
/* Flash estimate (nowcast.json ``flash``): value once its origin has passed, else when it will be available. */
function flashHTML() {
  var F = NC.flash; if (!F || !F.current) return "";
  var c = F.current.standard || {}, accOf = function (w, m) { var r = null; (F.accuracy || []).forEach(function (a) { if (a.window === w && a.model === m && a.lag_mode === "standard") r = a; }); return r || {}; };
  var fa = accOf("all", F.models[0]), ha = accOf("all", NC.headline.model), ft = accOf("test", F.models[0]);
  var h = '<div><h3 class="section-title">' + esc(tr("flash_title")) + '</h3><p style="margin:0 0 4px">';
  h += c.available ? esc(tr("flash_value", { q: F.target, v: pct(c.value, 2), b: pct(c.bottom_up, 2), e: pct(c.ensemble_h3, 2) })) : esc(tr("flash_pending", { q: F.target, d: fmtDate(c.origin) }));
  h += "</p>";
  if (fa.rmse != null) h += '<p class="muted" style="margin:0 0 4px;font-size:13px">' + esc(tr("flash_acc", { a: fa.first || winSpan("all")[0], z: fa.last || winSpan("all")[1], n: fa.N, f: nf(fa.rmse, 2), hn: ha.N, fm: nf(ha.flash_rmse != null ? ha.flash_rmse : fa.rmse, 2), h: nf(ha.rmse, 2), t: nf(ft.rmse, 2), ta: winSpan("test")[0], tz: winSpan("test")[1] })) + "</p>";
  return h + '<p class="muted" style="margin:0;font-size:12.5px">' + esc(tr("flash_note")) + "</p></div>";
}

/* Monitoring blocks (nowcast.json contributions / news / freshness / production_v2 / gdp_vintages / run_log). */
function monTable(head, rows, cls) { return '<div class="tablewrap" style="max-height:none"><table class="data plain' + (cls ? " " + cls : "") + '"><thead><tr>' + head.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr" + (r.cls ? ' class="' + r.cls + '"' : "") + ">" + r.c.map(function (x) { return "<td>" + x + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>"; }
function sgn(v, d) { if (v == null || isNaN(v)) return "–"; d = d == null ? 3 : d; var r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d); return r === 0 ? H.nf(0, d) : (r > 0 ? "+" : "") + H.nf(r, d); }
/* A number with exactly d decimals in the viewer's locale (H.nf drops trailing zeros). */
function nfx(v, d) {
  if (v == null || isNaN(v)) return "–";
  var s = H.nf(v, d); if (!d || Math.abs(v) >= 1000) return s;
  var m = /[.,](\d*)$/.exec(s);
  if (!m) return s + (H.nf(1.5, 1).replace(/[^.,]/g, "") || ".") + Array(d + 1).join("0");
  return s + Array(d - m[1].length + 1).join("0");
}
function expFmt(v) { if (v == null || isNaN(v)) return "–"; var a = Math.abs(v); return a !== 0 && a < 1e-3 ? v.toExponential(1) : nf(v, 4); }
/* The production V2 model ids (nowcast.json production_v2.spec.models: headline, dfm, umidas, development_weights). */
function V2() { return (NC.production_v2 && NC.production_v2.spec && NC.production_v2.spec.models) || {}; }
function statusHTML() {
  var st = NC.headline.status; if (!st) return "";
  return '<div class="ncrange">' + esc(tr(st.n_prospective > 0 ? "mon_status_progress" : "mon_status_pending", { n: st.n_prospective, d: fmtDate(st.adopted) })) + " " + esc(tr("mon_range")) + "</div>";
}
/* The headline's terms (contributions.terms[].term) in the viewer's language; numbers in a detail string in the locale's format. */
function termName(t) {
  var s = String(t || ""), m;
  if (s === "intercept") return tr("term_intercept");
  if ((m = /^factor, mean of (\S+)'s three months$/.exec(s))) return tr("term_factor", { q: m[1] });
  if ((m = /^GDP growth (\S+) \(as published\)$/.exec(s))) return tr("term_gdp", { q: m[1] });
  if ((m = /^USD\/UZS change, (\S+)$/.exec(s))) return tr("term_usd", { m: m[1] });
  return s;
}
function detailText(s) { return String(s || "").replace(/-?\d+(?:\.(\d+))?/g, function (x, d) { return H.nf(parseFloat(x), d ? d.length : 0); }).replace(/ x /g, " × "); }
function termsHTML() {
  var C = NC.contributions; if (!C || !C.terms || !C.terms.length) return "";
  var rows = C.terms.map(function (t) { return { c: [esc(label(t.member)), esc(termName(t.term)), '<span class="mono">' + esc(detailText(t.detail)) + "</span>", esc(nf(t.value, 3))] }; });
  rows.push({ cls: "total", c: ["", esc(tr("mon_total")), "", esc(nf(C.total, 3))] });
  return '<div><h3 class="section-title">' + esc(tr("mon_terms_title")) + "</h3>" + monTable([tr("mon_member"), tr("mon_term"), tr("mon_calc"), tr("mon_pp")], rows) +
    '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_terms_note", { v: nf(C.total, 3) })) + "</p></div>";
}
/* What the factor model's series say about the quarter (contributions.signals; descriptive, not additive). */
function signalsHTML() {
  var C = NC.contributions; if (!C || !C.signals || !C.signals.length) return "";
  var q = NC.target.quarter, sig = C.signals.slice().sort(function (x, y) { return (y.signal == null ? -1 : Math.abs(y.signal)) - (x.signal == null ? -1 : Math.abs(x.signal)); });
  var rows = sig.map(function (x) { var v = varByField(x.field); return { c: [esc((v && v.name) || x.name || x.field), esc(sgn(x.loading, 3)), esc(x.quarter_months || 0), esc(sgn(x.quarter_z, 2)), esc(sgn(x.signal, 3)), esc(x.share == null ? "–" : nf(x.share, 1) + "%")] }; });
  return '<div><h3 class="section-title">' + esc(tr("mon_sig_title", { q: q })) + "</h3>" + monTable([tr("mon_sig_series"), tr("mon_sig_load"), tr("mon_sig_months"), tr("mon_sig_z"), tr("mon_sig_sig"), tr("mon_sig_share")], rows) +
    '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_sig_note", { q: q })) + "</p></div>";
}
function newsName(x) {
  if (x.field == null) return /^GDP figures/.test(x.name || "") ? tr("news_gdp") : x.name === "other changes" ? tr("news_other") : (x.name || "–");
  var v = varByField(x.field), nm = (v && v.name) || String(x.name || x.field).replace(/ \(U-MIDAS re-estimated for the new stage\)$/, "");
  return x.member === V2().umidas ? tr("news_umidas", { s: nm }) : nm;
}
function newsHTML() {
  var N = NC.news; if (!N) return "";
  if (!N.available) return '<div><h3 class="section-title">' + esc(tr("mon_news_title", { a: N.from_stage || "–", b: N.stage || NC.target.stage })) + '</h3><p class="muted">' + esc(tr(N.from_stage ? "mon_news_missing" : "mon_news_first")) + "</p></div>";
  var rows = (N.steps || []).map(function (x) { return { c: [esc(label(x.member)), esc(newsName(x)), esc((x.months || []).join(", ") || "–"), esc(sgn(x.change, 4))] }; });
  return '<div><h3 class="section-title">' + esc(tr("mon_news_title", { a: N.from_stage, b: N.to_stage })) + '</h3><p style="margin:0 0 6px">' + esc(tr("mon_news_sum", { d: sgn(N.change, 4), u: sgn(N.dfm_change, 4), k: sgn(N.umidas_change, 4) })) + "</p>" +
    monTable([tr("mon_member"), tr("mon_source"), tr("mon_months"), tr("mon_pp")], rows) + '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_news_note")) + "</p></div>";
}
function freshBadge(s) { return '<span class="badge' + (s === "CURRENT" ? " ok" : s === "LAGGED" ? " warn" : s === "WITHHELD" ? "" : " bad") + '">' + esc(s || "–") + "</span>"; }
function freshHTML() {
  var F = NC.freshness; if (!F || !F.rows) return "";
  var used = function (u) { return u === "Factor model" ? tr("used_dfm") : u === "Factor model and U-MIDAS" ? tr("used_both") : (u || "–"); };
  var rows = F.rows.map(function (r) { return { c: [esc(r.input), esc(used(r.used_by)), esc(r.latest || "–"), esc(r.expected || "–"), freshBadge(r.status), esc(r.fetched || "–")] }; });
  var G = F.gdp, other = (F.stale_other_inputs || []).map(function (x) { return x.input + " (" + (x.latest || "–") + ")"; });
  var h = '<div><h3 class="section-title">' + esc(tr("mon_fresh_title", { d: fmtDate(F.as_of) })) + "</h3>" + monTable([tr("mon_input"), tr("mon_used"), tr("mon_latest"), tr("mon_expected"), tr("mon_status"), tr("mon_fetched")], rows);
  if (G) h += '<p style="margin:6px 0 0;font-size:13px">' + esc(tr("mon_fresh_gdp", { q: G.latest || "–", d: fmtDate(G.published), o: tr(G.origin === "hub" ? "src_hub" : "src_doc"), e: G.expected || "–" })) + " " + freshBadge(G.status) + "</p>";
  return h + '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_fresh_note")) + (other.length ? " " + esc(tr("mon_stale_other", { l: other.join("; ") })) : "") + "</p></div>";
}
function logHTML() {
  var L = NC.run_log; if (!L || !L.length) return "";
  var rows = L.slice(0, 20).map(function (r) { return { c: [esc(String(r.run_time).replace("T", " ").slice(0, 16)), esc(r.target), esc(r.stage), esc(r.label || label(r.model)) + (r.model_changed ? " ✱" : ""), esc(pct(r.value, 2)), esc(r.revision == null ? "–" : sgn(r.revision, 2))] }; });
  return '<div><h3 class="section-title">' + esc(tr("mon_log_title")) + "</h3>" + monTable([tr("mon_run"), tr("mon_target"), tr("mon_stage"), tr("mon_member"), tr("mon_value"), tr("mon_rev")], rows) + '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_log_note")) + "</p></div>";
}
/* Pooled accuracy of the headline next to its models and the previous headlines, on the headline's quarter-stage pairs:
   against today's GDP and SIAT's first release (gdp_vintages.accuracy) and in the test period (headline.accuracy). */
function cmpHTML() {
  var V = NC.gdp_vintages, hd = NC.headline; if (!V || !V.available) return "";
  var sp = winSpan("test"), prev = hd.previous || [], seen = {}, rows = [], ref = null;
  [hd.model].concat(Object.keys(hd.components || {}), [V2().development_weights], prev, ["ar2"]).forEach(function (m) {
    if (!m || seen[m]) return; seen[m] = 1;
    var a = null; (V.accuracy || []).forEach(function (x) { if (x.model === m && x.horizon === "pooled") a = x; });
    var t = hlAcc(m, "pooled", "test");
    if (!a && t.rmse == null) return;
    if (m === hd.model) ref = a;
    var tag = isHeadline(m) ? ' <span class="badge ok">' + esc(roleText("headline")) + "</span>" : prev.indexOf(m) >= 0 ? ' <span class="badge">' + esc(tr("role_previous")) + "</span>" : "";
    rows.push({ cls: isHeadline(m) ? "on" : "", c: [esc(label(m)) + tag, esc(a ? a.N : "–"), esc(nfx(a && a.rmse_latest, 3)), esc(nfx(a && a.rmse_first, 3)), esc(nfx(t.rmse, 3))] });
  });
  if (!rows.length || !ref) return "";
  var maxRev = 0;
  (V.revisions || []).forEach(function (r) { if (r.quarter >= ref.first && r.quarter <= ref.last) maxRev = Math.max(maxRev, Math.abs(r.revision || 0)); });
  return '<div><h3 class="section-title">' + esc(tr("cmp_title")) + "</h3>" + monTable([tr("model"), "N", tr("cmp_latest"), tr("cmp_first"), tr("cmp_test", { a: sp[0], b: sp[1] })], rows) +
    '<p class="muted" style="font-size:12.5px">' + esc(tr("cmp_note", { n: ref.N, a: ref.first, z: ref.last, r: nf(maxRev, 1) })) + "</p></div>";
}
/* The GDP figures the headline was estimated on (production_v2.information_set) and the reproduction check. */
function infoHTML() {
  var P = NC.production_v2; if (!P || !P.information_set) return "";
  var I = P.information_set, cols = I.columns || [], ix = function (k) { return cols.indexOf(k); }, now = {};
  ((NC.gdp_vintages || {}).information_set || []).forEach(function (r) { now[r.quarter] = r.latest; });
  var rows = (I.rows || []).map(function (r) {
    var q = r[ix("quarter")], v = r[ix("value")], l = now[q], rev = l != null && v != null && Math.abs(l - v) > 1e-9;
    return { c: [esc(q), esc(nf(v, 1)), esc(fmtDate(r[ix("published")])), esc(tr(r[ix("origin")] === "hub" ? "src_hub" : "src_doc")), rev ? "<b>" + esc(nf(l, 1)) + "</b>" : esc(nf(l, 1))] };
  }).reverse();
  if (!rows.length) return "";
  var head = [tr("quarter"), tr("mon_info_used"), tr("mon_info_pub"), tr("mon_info_src"), tr("mon_info_now")];
  var h = '<div><h3 class="section-title">' + esc(tr("mon_info_title", { q: P.target, d: fmtDate(P.origin) })) + "</h3>" + monTable(head, rows.slice(0, 6));
  if (rows.length > 6) h += '<details class="ncmore"><summary>' + esc(tr("mon_info_more", { n: rows.length })) + "</summary>" + monTable(head, rows) + "</details>";
  return h + '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_info_note")) + "</p>" + reproHTML() + "</div>";
}
function reproHTML() {
  var R = (NC.production_v2 || {}).reproduction; if (!R || !R.available) return "";
  var cur = null; (R.current || []).forEach(function (c) { if (c.model === NC.headline.model) cur = c; });
  return '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_repro", { c: String(R.commit || "").slice(0, 7), n: R.n_compared, v: cur ? nf(cur.production, 4) : "–", d: expFmt(R.max_abs_diff) })) +
    ' <span class="badge' + (R.status === "reproduced" ? " ok" : " warn") + '">' + esc(tr(R.status === "reproduced" ? "repro_ok" : "repro_diff")) + "</span></p>";
}
/* First-release scoring by stage: the headline, the previous headline and AR(2); SIAT's revisions in a collapsible table. */
function vintHTML() {
  var V = NC.gdp_vintages, hd = NC.headline; if (!V || !V.available) return "";
  var rows = [];
  [hd.model].concat((hd.previous || []).slice(0, 1), ["ar2"]).forEach(function (m) {
    ["H1", "H2", "H3", "pooled"].forEach(function (hz) {
      (V.accuracy || []).forEach(function (a) { if (a.model === m && a.horizon === hz) rows.push({ cls: hz === "pooled" ? "total" : "", c: [esc(label(m)), esc(hz === "pooled" ? tr("pooled") : hz), esc(a.N), esc(nfx(a.rmse_first, 3)), esc(nfx(a.rmse_latest, 3)), esc(sgn(a.bias_first, 2)), esc(sgn(a.bias_latest, 2))] }); });
    });
  });
  var revised = (V.revisions || []).filter(function (r) { return Math.abs(r.revision || 0) > 1e-9; });
  var h = '<div><h3 class="section-title">' + esc(tr("mon_vint_title")) + "</h3>" + monTable([tr("mon_member"), tr("mon_stage"), "N", tr("mon_first"), tr("mon_last"), tr("mon_bias_first"), tr("mon_bias_last")], rows) +
    '<p class="muted" style="font-size:12.5px">' + esc(tr("mon_vint_note", { d: fmtDate(V.hub_since || (hd.status || {}).adopted || (hd.production || {}).adopted), n: V.n_first_release, r: revised.length }) + " " + tr("mon_bias_note")) + "</p>";
  if ((V.revisions || []).length) {
    var rev = V.revisions.slice().reverse().map(function (r) { return { c: [esc(r.quarter), esc(nf(r.first, 1)), esc(nf(r.latest, 1)), esc(sgn(r.revision, 1)), esc(r.n)] }; });
    h += '<details class="ncmore"><summary>' + esc(tr("mon_rev_title", { n: rev.length })) + "</summary>" + monTable([tr("quarter"), tr("mon_rev_first"), tr("mon_info_now"), tr("mon_rev_diff"), tr("mon_rev_n")], rev) + "</details>";
  }
  return h + "</div>";
}

function renderOverview() {
  var el = body(), T = NC.target, hd = NC.headline, ra = hd.indicative_range || {}, comps = hd.components || {}, wts = hd.weights || {};
  var avail = NC.data_availability.summary, span = winSpan("all");
  var h = '<div class="nchead"><h2>' + esc(tr("title")) + " — " + esc(T.quarter) + '</h2><p class="muted">' + esc(tr("stage", { h: T.stage, d: fmtDate(T.origin) })) + " · " + esc(tr("updated", { d: fmtDate(NC.as_of), m: fmtMonth(T.latest_usable_reference_period) })) + "</p></div>";
  var aH = hlAcc(hd.model, T.stage), aB = hlAcc("ar2", T.stage), pH = hlAcc(hd.model, "pooled"), pB = hlAcc("ar2", "pooled");
  var mem = Object.keys(comps), prev = hd.previous || [], fb = hd.value == null ? hd.fallback : null;
  h += '<div class="nchero"><div class="nchl rec"><span class="section-title">' + esc(tr("headline")) + '</span><div class="ncbig">' + esc(pct(fb ? fb.value : hd.value, 1)) + '</div><div class="muted">' + esc(tr("gdp_yoy")) + " · " + esc(label(fb ? fb.model : hd.model)) + "</div>";
  if (fb) h += '<div class="ncrange note">' + esc(tr("hl_fallback", { r: Object.keys(fb.reasons || {}).map(function (m) { return label(m) + ": " + fb.reasons[m]; }).join("; ") || "–", m: label(fb.model), v: pct(fb.value, 2) })) + "</div>";
  if (mem.length) h += '<div class="ncrange">' + esc(mem.map(function (m) { return label(m) + " " + pct(comps[m], 2) + (wts[m] != null ? " × " + nf(wts[m], 1) : ""); }).join(" · ")) + "</div>";
  if (ra.low != null) h += '<div class="ncrange">' + esc(tr("range", { a: pct(ra.low, 2), b: pct(ra.high, 2), h: nf(ra.halfwidth, 3), n: ra.n_forecasts }) + (ra.first_release_halfwidth != null ? ". " + tr("range_first", { f: nf(ra.first_release_halfwidth, 3), n: ra.first_release_n }) : "")) + "</div>";
  if (aH.rmse != null) h += '<div class="ncrange">' + esc(tr("hl_acc", { h: T.stage, r: nf(aH.rmse, 2), b: nf(aB.rmse, 2), n: aH.N, a: aH.first, z: aH.last, pr: nf(pH.rmse, 2), pb: nf(pB.rmse, 2) })) + "</div>";
  h += '<div class="ncrange">' + esc(tr("ytd_note", { q: T.quarter, span: ytdSpan(T.quarter, H.L()) })) + "</div>";
  h += statusHTML();
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' + calcButton(hd.model) + mem.map(function (m) { return calcButton(m, { text: label(m) }); }).join("") + "</div></div>";
  h += '<div class="nckpis">' + kpi(tr("latest_gdp"), pct(T.latest_gdp.value, 1), T.latest_gdp.quarter) +
    kpi(tr("indicators_usable"), avail.available + " / " + avail.registered, tr("target_months", { q: T.quarter }) + ": " + T.release_eligible_target_quarter_records) +
    kpi(tr("conservative"), pct(hd.conservative_value, 2), label(hd.model)) +
    kpi(tr("hl_benchmark"), pct(currentValue("ar2"), 2), label("ar2")) + "</div></div>";
  var desc = NT["hl_desc_" + hd.model] ? tr("hl_desc_" + hd.model) : (hd.description || "");
  h += '<p class="muted" style="margin:0;font-size:13px">' + esc(desc) + " " + esc(NT["hl_sel_" + hd.model] ? tr("hl_sel_" + hd.model) : tr("hl_sel", { a: span[0], b: span[1] })) + "</p>";
  (NC.alerts || []).forEach(function (al) { if (al.kind === "fx_month_partial") h += '<p class="note">' + esc(tr("align_warn", { m: fmtMonth(al.stage_month), h: al.previous_stage || "–", v: nf(al.previous_stage_headline != null ? al.previous_stage_headline : al.previous_stage_ensemble, 2), u: nf(al.previous_stage_headline_umidas != null ? al.previous_stage_headline_umidas : al.previous_stage_umidas, 2) })) + "</p>"; });
  h += '<div><h3 class="section-title">' + esc(tr("components")) + '</h3><div class="cards nccomp">';
  [hd.model].concat(mem, prev.slice(0, 1), ["ar2"]).forEach(function (m) {
    h += '<div class="card' + (isHeadline(m) ? " on" : "") + '"><span>' + esc(label(m)) + '</span><strong class="ncv">' + esc(pct(currentValue(m, "standard"), 2)) + "</strong><span>" + (wts[m] != null ? "× " + nf(wts[m], 1) : esc(prev.indexOf(m) >= 0 ? tr("role_previous") : roleText(isHeadline(m) ? "headline" : ROLE[m]))) + "</span><div>" + calcButton(m) + "</div></div>";
  });
  h += "</div></div>";
  h += cmpHTML() + termsHTML() + signalsHTML() + newsHTML() + infoHTML() + flashHTML() + freshHTML() + vintHTML() + logHTML();
  var TS = S.trust; if (!TS.h) TS.h = T.stage;
  h += '<div><h3 class="section-title">' + esc(tr("trust_title")) + '</h3><div class="toolbar" style="justify-content:flex-start;gap:14px;margin-bottom:8px">' +
    '<label class="ctl">' + esc(tr("horizon")) + seg("trh", TS.h, ["H1", "H2", "H3"].map(function (x) { return [x, x]; })) + "</label>" +
    '<label class="ctl">' + esc(tr("lag")) + seg("trl", TS.lag, [["standard", tr("lag_standard")], ["conservative", tr("lag_conservative")]]) + '</label></div><div id="nc-trust"><p class="muted">' + esc(tr("loading")) + '</p></div><p class="muted" style="font-size:12.5px">' + esc(tr("trust_note", { a: span[0], b: span[1] })) + "</p></div>";
  // charts, each with a model picker
  var evoAvail = [], seenE = {};
  (NC.evolution.reconstructed || []).forEach(function (r) { if (!seenE[r.model]) { seenE[r.model] = 1; evoAvail.push(r.model); } });
  evoAvail.sort(function (a, b) { return chartModels().indexOf(a) - chartModels().indexOf(b); });
  var evoDef = [hd.model].concat(mem, prev, ["ar2"]);
  var P = predIndex(), avfAvail = chartModels().filter(function (m) { return P[m]; }), avfDef = [hd.model].concat(mem, prev.slice(0, 1), ["ar2"]);
  var dotAvail = chartModels().filter(function (m) { return currentValue(m) != null; }), dotDef = dotAvail.slice();
  if (!S.avfH) S.avfH = "H3";
  h += '<div><h3 class="section-title">' + esc(tr("evolution", { q: T.quarter })) + "</h3>" + pickerHTML("evo", evoAvail, picked("evo", evoAvail, evoDef)) + '<div class="chart-box" id="nc-evo"></div><div id="nc-evo-leg"></div><p class="muted" style="font-size:12.5px">' + esc(tr("evolution_note")) + "</p></div>";
  h += '<div><h3 class="section-title">' + esc(tr("actual_vs", { h: S.avfH })) + '</h3><div class="toolbar" style="justify-content:flex-start;gap:14px;margin-bottom:6px"><label class="ctl">' + esc(tr("horizon")) + seg("avfh", S.avfH, ["H1", "H2", "H3"].map(function (x) { return [x, x]; })) + "</label></div>" + pickerHTML("avf", avfAvail, picked("avf", avfAvail, avfDef)) + '<div class="chart-box" id="nc-avf"></div><div id="nc-avf-leg"></div></div>';
  h += '<div><h3 class="section-title">' + esc(tr("models_now", { q: T.quarter })) + "</h3>" + pickerHTML("dots", dotAvail, picked("dots", dotAvail, dotDef)) + '<div class="chart-box" id="nc-dots"></div><p class="muted" style="font-size:12.5px">' + esc(tr("models_now_note")) + "</p></div>";
  el.innerHTML = h;
  // evolution by stage
  var hz = ["H1", "H2", "H3"].filter(function (x) { return x <= T.stage; }), rec = NC.evolution.reconstructed || [];
  function drawEvo(list) {
    var ser = list.map(function (m, i) { return { name: label(m), color: colorFor(m, i), width: isHeadline(m) ? 3 : 2, dash: i >= 4 && !isHeadline(m) ? "5 4" : null, values: hz.map(function (x) { var v = null; rec.forEach(function (r) { if (r.model === m && r.horizon === x) v = r.value; }); return v; }) }; }).filter(function (s) { return s.values.some(function (v) { return v != null; }); });
    drawLine("nc-evo", { labels: hz.map(function (x) { var d = (NC.target.cutoffs || {})[x]; return x + (d ? " · " + d.slice(5) : ""); }), series: ser, marker: true }); document.getElementById("nc-evo-leg").innerHTML = legendHTML(ser);
  }
  // official GDP vs nowcasts at the chosen stage
  var qs = PANEL.quarterly.quarters, gdp = PANEL.quarterly.gdp_real_yoy_pct, from = Math.max(0, qs.indexOf(recordFirst()));
  var labs = qs.slice(from).concat(qs.indexOf(T.quarter) < 0 ? [T.quarter] : []);
  function drawAvf(list) {
    var s1 = { name: tr("actual"), color: 0, width: 3, values: labs.map(function (q) { var i = qs.indexOf(q); return i >= 0 ? gdp[i] : null; }) };
    var ser = [s1].concat(list.map(function (m, i) { var pr = predRows(m, S.avfH, "standard"); return { name: label(m), color: colorFor(m, i), width: isHeadline(m) ? 2.5 : 2, dash: m === "ar2" ? "4 4" : null, values: labs.map(function (q) { return pr[q] != null ? pr[q] : (q === T.quarter && S.avfH === T.stage ? currentValue(m) : null); }) }; }));
    drawLine("nc-avf", { labels: labs, series: ser }); document.getElementById("nc-avf-leg").innerHTML = legendHTML(ser);
  }
  function drawDots(list) {
    var items = list.map(function (m) { var r = modelRow(m) || {}, d = r.details || {}; return { label: shortLabel(m), value: currentValue(m), strong: isHeadline(m), band68: d.band68, band90: d.band90 }; }).filter(function (it) { return it.value != null; });
    var box = document.getElementById("nc-dots"); box.innerHTML = items.length ? dotPlot(items, { value: hd.value }, false, Math.max(360, box.clientWidth || 720)) : '<p class="muted">–</p>';
  }
  drawEvo(picked("evo", evoAvail, evoDef)); drawAvf(picked("avf", avfAvail, avfDef)); drawDots(picked("dots", dotAvail, dotDef));
  bindPicker(el, "evo", evoAvail, evoDef, drawEvo); bindPicker(el, "avf", avfAvail, avfDef, drawAvf); bindPicker(el, "dots", dotAvail, dotDef, drawDots);
  bindCalc(el);
  bindSeg(el, "avfh", function (v) { S.avfH = v; renderOverview(); var t = document.getElementById("nc-avf"); if (t && t.scrollIntoView) t.scrollIntoView({ block: "nearest" }); });
  bindSeg(el, "trh", function (v) { S.trust.h = v; renderOverview(); var t = document.getElementById("nc-trust"); if (t && t.scrollIntoView) t.scrollIntoView({ block: "nearest" }); });
  bindSeg(el, "trl", function (v) { S.trust.lag = v; renderOverview(); var t = document.getElementById("nc-trust"); if (t && t.scrollIntoView) t.scrollIntoView({ block: "nearest" }); });
  loadEcon().then(drawTrust, function (e) { var t = document.getElementById("nc-trust"); if (t) t.innerHTML = '<p class="note">' + esc(e.message) + "</p>"; });
}
/* Published predictions indexed by model -> "quarter|stage|lags" -> [prediction, actual]. */
var PIDX = null, PROWS = null, CTX = null;
function predIndex() {
  if (PIDX) return PIDX;
  PIDX = {};
  NC.predictions.rows.forEach(function (r) { var m = PIDX[r[0]] || (PIDX[r[0]] = {}); m[r[1] + "|" + r[2] + "|" + r[3]] = [r[5], r[6]]; });
  return PIDX;
}
function predObjRows() {
  if (!PROWS) PROWS = NC.predictions.rows.map(function (r) { return { model: r[0], target: r[1], horizon: r[2], lagMode: r[3], prediction: r[5], actual: r[6] }; });
  return PROWS;
}
function getCtx(E) { if (!CTX) CTX = E.data.fromPanel(PANEL); return CTX; }
function rmseOf(e) { var s = 0; e.forEach(function (x) { s += x * x; }); return e.length ? Math.sqrt(s / e.length) : NaN; }
/* Every model of the run ranked by RMSE relative to AR(2) on the same quarters (pseudo-real time, evaluation window). */
function rankModels(E, h, lag) {
  var P = predIndex(), W = NC.accuracy.windows, sel = W.selection || [], tst = W.test || [], all = W.all || sel.concat(tst), b = P.ar2 || {}, out = [];
  Object.keys(P).forEach(function (m) {
    var pm = P[m], e1 = [], e2 = [], qs = [];
    all.forEach(function (q) {
      var k = q + "|" + h + "|" + lag, a = pm[k], c = b[k];
      if (!a || !c || a[0] == null || c[0] == null || a[1] == null) return;
      e1.push(a[1] - a[0]); e2.push(a[1] - c[0]); qs.push(q);
    });
    if (e1.length < 4) return;
    var win = function (w) { var x = [], y = []; qs.forEach(function (q, i) { if (w.indexOf(q) >= 0) { x.push(e1[i]); y.push(e2[i]); } }); return x.length >= 2 ? rmseOf(x) / rmseOf(y) : null; };
    var dm = m === "ar2" ? null : E.stats.dieboldMariano(e1, e2), now = pm[NC.target.quarter + "|" + h + "|" + lag];
    out.push({ model: m, n: e1.length, rmse: rmseOf(e1), rel: rmseOf(e1) / rmseOf(e2), sel: win(sel), tst: win(tst), p: dm && !isNaN(dm.pLess) ? dm.pLess : null, now: now ? now[0] : null });
  });
  out.sort(function (a, b) { return a.rel - b.rel || a.rmse - b.rmse; });
  return out;
}
function relBadge(rel) {
  var cls = rel == null ? "" : rel < 0.95 ? "ok" : rel > 1.05 ? "bad" : "";
  return '<span class="badge ' + cls + '">' + nf(rel, 2) + "</span>";
}
function drawTrust(E) {
  var box = document.getElementById("nc-trust"); if (!box) return;
  var TS = S.trust, rows = rankModels(E, TS.h, TS.lag);
  if (!rows.length) { box.innerHTML = '<p class="muted">–</p>'; return; }
  var cand = rows.filter(function (r) { return r.model !== "ar2" && r.n >= 8 && !isExp(r.model); }), best = cand[0];
  var sig = rows.filter(function (r) { return r.p != null && r.p < 0.10 && r.rel < 1 && !isExp(r.model); });
  var h = '<div class="verdict">';
  if (best && best.rel < 1) h += "<p><b>" + esc(tr("trust_best", { h: TS.h, m: label(best.model), r: nf(best.rmse, 2), p: nf(100 * (1 - best.rel), 0), d: nf(best.p, 3) })) + "</b></p>";
  h += "<p>" + esc(sig.length ? tr("trust_sig", { l: sig.map(function (r) { return label(r.model); }).join(", ") }) : tr("trust_nosig")) + "</p>";
  if (rows.some(function (r) { return isExp(r.model); })) h += '<p class="muted" style="font-size:12.5px">' + esc(tr("trust_exp")) + "</p>";
  h += "</div>";
  h += '<div class="tablewrap" style="max-height:520px;margin-top:8px"><table class="data"><thead><tr><th>' + esc(tr("model")) + "</th><th>" + esc(tr("nowcast_now", { q: NC.target.quarter })) + "</th><th>" + esc(tr("trust_n")) + "</th><th>RMSE</th><th>" + esc(tr("trust_all")) + "</th><th>" + esc(tr("trust_sel")) + "</th><th>" + esc(tr("trust_test")) + "</th><th>" + esc(tr("trust_dm")) + "</th><th></th></tr></thead><tbody>";
  rows.forEach(function (r, i) {
    var bar = '<span class="relbar"><i style="width:' + Math.min(100, r.rel / 2 * 100).toFixed(0) + '%"></i></span>';
    h += "<tr" + (isHeadline(r.model) ? ' class="on"' : "") + "><td>" + (i + 1) + ". " + esc(label(r.model)) + '<div class="muted" style="font-size:11.5px">' + esc(famLine(r.model) + (isHeadline(r.model) ? " · " + roleText("headline") : isExp(r.model) ? " · " + roleText("experimental") : "")) + "</div></td><td>" + esc(pct(r.now, 2)) + "</td><td>" + r.n + "</td><td>" + nf(r.rmse, 3) + "</td><td>" + relBadge(r.rel) + " " + bar + "</td><td>" + relBadge(r.sel) + "</td><td>" + relBadge(r.tst) + "</td><td>" +
      (r.p == null ? "–" : '<span class="badge' + (r.p < 0.10 && r.rel < 1 ? " ok" : "") + '">' + nf(r.p, 3) + "</span>") + "</td><td>" + calcButton(r.model, { h: TS.h, lag: TS.lag }) + "</td></tr>";
  });
  box.innerHTML = h + "</tbody></table></div>";
  bindCalc(box);
}
function kpi(lab, val, sub) { return '<div class="nckpi"><span class="muted">' + esc(lab) + "</span><b>" + esc(val) + "</b>" + (sub ? '<span class="muted">' + esc(sub) + "</span>" : "") + "</div>"; }
function predRows(model, hz, lag) {
  var out = {}, rows = NC.predictions.rows;
  for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r[0] === model && r[2] === hz && r[3] === lag) out[r[1]] = r[5]; }
  return out;
}

/* ---------------- accuracy ---------------- */
function renderAccuracy() {
  var el = body(), A = S.acc, W = NC.accuracy.windows || {};
  if (!W[A.win]) A.win = "all";
  var wl = function (w) { var sp = winSpan(w); return tr("win_" + w, { a: sp[0], b: sp[1] }); };
  var h = '<div class="toolbar" style="justify-content:flex-start;gap:14px">' +
    '<label class="ctl">' + esc(tr("window")) + seg("win", A.win, ["all", "selection", "test", "record"].filter(function (w) { return W[w] && W[w].length; }).map(function (w) { return [w, wl(w)]; })) + "</label>" +
    '<label class="ctl">' + esc(tr("lag")) + seg("lag", A.lag, [["standard", tr("lag_standard")], ["conservative", tr("lag_conservative")]]) + "</label>" +
    '<label class="ctl">' + esc(tr("horizon")) + seg("hz", A.hz, [["H1", "H1"], ["H2", "H2"], ["H3", "H3"], ["pooled", tr("pooled")]]) + "</label>" +
    '<label class="ctl">' + esc(tr("acc_show")) + seg("show", A.show || "main", [["main", tr("acc_main")], ["every", tr("acc_every")]]) + "</label></div>";
  var rows = NC.accuracy.rows.filter(function (r) { return r[4] === A.win && r[5] === A.lag && r[6] === A.hz; });
  var sk = A.win === "record" ? 11 : 8;   // the full record: spans differ, so rank by RMSE relative to AR(2) on each model's quarters
  rows.sort(function (a, b) { return (a[sk] == null) - (b[sk] == null) || a[sk] - b[sk] || a[8] - b[8]; });
  var keep = (A.show || "main") === "every" ? rows : rows.filter(function (r) { return r[3] !== "single"; });
  var rec = A.win === "record";
  h += '<div class="tablewrap" style="max-height:560px"><table class="data"><thead><tr><th>' + esc(tr("model")) + "</th><th>" + esc(tr("role")) + "</th>" + (rec ? "<th>" + esc(tr("acc_first")) + "</th>" : "") + "<th>N</th><th>RMSE</th><th>MAE</th><th>Bias</th><th>" + esc(tr("rel_ar2")) + "</th><th>" + esc(tr("nowcast_now", { q: NC.target.quarter })) + "</th><th></th></tr></thead><tbody>";
  keep.forEach(function (r) {
    var rel = r[11], cls = rel == null ? "" : rel < 0.95 ? "ok" : rel > 1.05 ? "bad" : "";
    var bar = rel == null ? "" : '<span class="relbar"><i style="width:' + Math.min(100, rel / 2 * 100).toFixed(0) + '%"></i></span>';
    h += "<tr" + (isHeadline(r[0]) ? ' class="on"' : "") + '><td><button class="linkbtn" style="text-align:left" data-pm="' + esc(r[0]) + '">' + esc(r[1]) + '</button><div class="muted" style="font-size:11.5px">' + esc(famLine(r[0], FAMILY[r[0]] || r[2])) + "</div></td><td>" + esc(roleText(isHeadline(r[0]) ? "headline" : r[3])) + "</td>" + (rec ? "<td>" + esc(r[12] || "–") + "</td>" : "") + "<td>" + r[7] + "</td><td>" + nf(r[8], 3) + "</td><td>" + nf(r[9], 3) + "</td><td>" + nf(r[10], 3) + '</td><td><span class="badge ' + cls + '">' + nf(rel, 2) + "</span> " + bar + "</td><td>" + esc(pct(currentValue(r[0], A.lag), 2)) + "</td><td>" + calcButton(r[0], { h: A.hz === "pooled" ? null : A.hz, lag: A.lag }) + "</td></tr>";
  });
  var trn = trainingRule();
  h += '</tbody></table></div><p class="muted" style="font-size:12.5px">' + esc(rec ? tr("acc_note_record", { a: recordFirst(), p: trn.production_first || "2021Q1", e: trn.early_train_start || "2016Q1", s: trn.train_start || "2018Q1" }) : tr("acc_note")) + "</p>";
  var P = predIndex(), pm = chartModels().filter(function (m) { return P[m]; });
  if (!S.predModel || pm.indexOf(S.predModel) < 0) S.predModel = headlineId();
  h += '<div><h3 class="section-title">' + esc(tr("preds")) + '</h3><div class="calcbar" style="margin-bottom:6px"><label>' + esc(tr("model")) + '<select id="nc-pm">' + pm.map(function (m) { return '<option value="' + esc(m) + '"' + (m === S.predModel ? " selected" : "") + ">" + esc(label(m)) + "</option>"; }).join("") + '</select></label></div><div class="chart-box" id="nc-pchart"></div><div id="nc-pleg"></div><div class="tablewrap" id="nc-ptable"></div></div>';
  var specs = NC.model_specs || {};
  h += '<details class="meta"><summary>' + esc(tr("specs")) + '</summary><dl class="meta-list">' + Object.keys(specs).map(function (k) { return "<div><dt>" + esc(label(k)) + ' <span class="mono">' + esc(k) + "</span></dt><dd>" + esc(specs[k]) + "</dd></div>"; }).join("") + "</dl></details>";
  el.innerHTML = h;
  bindSeg(el, "win", function (v) { A.win = v; renderAccuracy(); });
  bindSeg(el, "lag", function (v) { A.lag = v; renderAccuracy(); });
  bindSeg(el, "hz", function (v) { A.hz = v; renderAccuracy(); });
  bindSeg(el, "show", function (v) { A.show = v; renderAccuracy(); });
  var sel = document.getElementById("nc-pm"); if (sel) sel.onchange = function () { S.predModel = sel.value; drawPreds(); };
  Array.prototype.forEach.call(el.querySelectorAll("[data-pm]"), function (b) { b.onclick = function () { var m = b.getAttribute("data-pm"); if (!predIndex()[m]) { openCalc(m, { lag: S.acc.lag }); return; } S.predModel = m; var sl = document.getElementById("nc-pm"); if (sl) sl.value = m; drawPreds(); var t = document.getElementById("nc-pchart"); if (t && t.scrollIntoView) t.scrollIntoView({ block: "center", behavior: "smooth" }); }; });
  bindCalc(el);
  drawPreds();
}
function drawPreds() {
  var m = S.predModel, lag = S.acc.lag, qs = [], byQ = {};
  NC.predictions.rows.forEach(function (r) { if (r[0] !== m || r[3] !== lag) return; if (!byQ[r[1]]) { byQ[r[1]] = { actual: r[6] }; qs.push(r[1]); } byQ[r[1]][r[2]] = r[5]; });
  qs.sort();
  var ser = [{ name: tr("actual"), color: 0, width: 3, values: qs.map(function (q) { return byQ[q].actual; }) }].concat(["H1", "H2", "H3"].map(function (x, i) { return { name: label(m) + " · " + x, color: i + 1, dash: i < 2 ? "4 3" : null, values: qs.map(function (q) { return byQ[q][x]; }) }; }));
  drawLine("nc-pchart", { labels: qs, series: ser }); document.getElementById("nc-pleg").innerHTML = legendHTML(ser);
  var t = '<table class="data"><thead><tr><th>' + esc(tr("quarter")) + "</th><th>" + esc(tr("actual")) + "</th><th>H1</th><th>H2</th><th>H3</th></tr></thead><tbody>";
  qs.slice().reverse().forEach(function (q) { var r = byQ[q]; t += "<tr><td>" + esc(q) + "</td><td>" + nf(r.actual, 2) + "</td><td>" + nf(r.H1, 2) + "</td><td>" + nf(r.H2, 2) + "</td><td>" + nf(r.H3, 2) + "</td></tr>"; });
  document.getElementById("nc-ptable").innerHTML = t + "</tbody></table>";
}

/* ---------------- calculations ---------------- */
var POOL = { combo_equal: "equal", combo_invmse: "invmse" };
var TRANSFORM_DOC = {   // uzdata/nowcast/registry.py
  GDP_TARGET: "published index (same quarter of the previous year = 100) minus 100",
  DECUM_YOY: "year-to-date table de-cumulated to months, then 100·ln(x_t / x_t−12)",
  DECUM_LEVEL: "year-to-date table de-cumulated to monthly levels",
  NON_GOLD: "de-cumulated total exports minus the de-cumulated gold proxy, then 100·ln(x_t / x_t−12)",
  MOM_INDEX_LOG: "index with the previous month = 100, as 100·ln(index/100)",
  FX_MONTHLY_DLOG: "monthly mean of the official daily rates, then 100·(ln m_t − ln m_t−1)",
  PRICE_DLOG: "monthly price, 100·(ln p_t − ln p_t−1)",
  STOCK_YOY: "end-of-month stock, 100·ln(x_t / x_t−12)",
  FLOW_YOY: "monthly flow, 100·ln(x_t / x_t−12)"
};
var SHEET = { design: "Design matrix", xtx: "XtX", xtx_inv: "XtX inverse", xty: "Xty and beta", coef: "Coefficients", fit: "Fit statistics", fitted: "Fitted and residuals",
  grid: "Grid search", weights: "Lag weights", s_now: "S at the origin", basis: "Almon basis", implied: "Implied lag weights", z_now: "Almon at the origin", fields: "Panel fields",
  em: "EM estimation", factors: "Monthly factors", target_factor: "Target-quarter factors", A: "Factor VAR A", Q: "Factor VAR Q", candidates: "Candidates", folds: "CV folds",
  cv: "CV path", z: "Standardised Z", chosen: "Final fit", data: "BVAR sample", prior: "Prior", dummies: "Dummy observations", B: "Posterior B", S: "Posterior S",
  conditioning: "Conditioning", draws: "Draws summary", draws_list: "All draws", members: "Members", history: "Member errors", sample: "Sample" };
function fnum(v, dp) {
  if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "–";
  if (typeof v !== "number") return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e9) return String(v);
  var a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e8)) return v.toExponential(4);
  return v.toFixed(dp == null ? 6 : dp);
}
function calcModels() {
  var seen = {}, out = [], hd = NC.headline;
  function grp(key, models) { var list = []; models.forEach(function (m) { if (m && !seen[m]) { seen[m] = 1; list.push(m); } }); if (list.length) out.push({ key: key, models: list }); }
  function byRole(r) { return (NC.models || []).filter(function (x) { return x.role === r; }).map(function (x) { return x.model; }); }
  grp("cg_headline", [hd.model].concat(Object.keys(hd.components || {})));
  grp("cg_benchmarks", byRole("benchmark"));
  grp("cg_models", byRole("model"));
  grp("cg_experimental", byRole("experimental"));
  grp("cg_combinations", byRole("combination"));
  grp("cg_single", (NC.single_indicator || []).map(function (r) { return r.model; }));
  return out;
}
function renderCalcIndex() {
  var el = body();
  var h = '<div class="nchead"><h2>' + esc(tr("calc_index_title")) + '</h2><p class="muted" style="font-size:13.5px;max-width:860px">' + esc(tr("calc_intro")) + "</p></div>";
  calcModels().forEach(function (g) {
    h += '<div><h3 class="section-title">' + esc(tr(g.key)) + ' <span class="muted">(' + g.models.length + ')</span></h3><div class="calc-list">' + g.models.map(function (m) {
      return '<button class="calc-item" data-calc="' + esc(m) + '"><b>' + esc(label(m)) + "</b><span>" + esc(pct(currentValue(m, "standard"), 2)) + "</span></button>";
    }).join("") + "</div></div>";
  });
  el.innerHTML = h;
  bindCalc(el);
}
function renderCalc() {
  var c = S.calc;
  if (!c.model) return renderCalcIndex();
  var el = body(), T = NC.target;
  if (!c.q) c.q = T.quarter; if (!c.h) c.h = T.stage; if (!c.lag) c.lag = "standard";
  var qs = PANEL.quarterly.quarters.filter(function (q) { return q >= recordFirst(); }); if (qs.indexOf(T.quarter) < 0) qs.push(T.quarter);
  qs = qs.slice().reverse();
  var stages = ["H1", "H2", "H3"].filter(function (x) { return c.q !== T.quarter || x <= T.stage; });
  if (stages.indexOf(c.h) < 0) c.h = stages[stages.length - 1];
  var opts = c.spec ? '<option value="' + esc(c.model) + '" selected>Lab: ' + esc(c.model) + "</option>" : calcModels().map(function (g) {
    return '<optgroup label="' + esc(tr(g.key)) + '">' + g.models.map(function (m) { return '<option value="' + esc(m) + '"' + (m === c.model ? " selected" : "") + ">" + esc(label(m)) + "</option>"; }).join("") + "</optgroup>";
  }).join("");
  var h = '<div class="calcbar"><button class="btn" id="calc-back">' + esc(tr("calc_back")) + '</button><button class="btn" id="calc-all">' + esc(tr("calc_all")) + "</button>" +
    '<label>' + esc(tr("calc_model")) + '<select id="calc-model"' + (c.spec ? " disabled" : "") + ">" + opts + "</select></label>" +
    '<label>' + esc(tr("calc_quarter")) + '<select id="calc-q">' + qs.map(function (q) { return "<option" + (q === c.q ? " selected" : "") + ">" + q + "</option>"; }).join("") + "</select></label>" +
    '<label class="ctl">' + esc(tr("horizon")) + seg("ch", c.h, stages.map(function (x) { return [x, x]; })) + "</label>" +
    '<label class="ctl">' + esc(tr("lag")) + seg("cl", c.lag, [["standard", tr("lag_standard")], ["conservative", tr("lag_conservative")]]) + "</label></div>";
  h += '<div id="calc-out"><p class="muted">' + esc(tr("calc_computing")) + "</p></div>";
  el.innerHTML = h;
  document.getElementById("calc-back").onclick = function () { go(c.from && c.from !== "calc" ? c.from : "overview"); };
  document.getElementById("calc-all").onclick = function () { go("calc"); };
  var ms = document.getElementById("calc-model"); if (ms) ms.onchange = function () { openCalc(ms.value, { q: c.q, h: c.h, lag: c.lag }); };
  document.getElementById("calc-q").onchange = function (e) { c.q = e.target.value; refreshCalc(); };
  bindSeg(el, "ch", function (v) { c.h = v; refreshCalc(); });
  bindSeg(el, "cl", function (v) { c.lag = v; refreshCalc(); });
  computeCalc();
}
function refreshCalc() {
  try { history.replaceState(null, "", "#nowcast/" + calcPath()); } catch (e) {}
  renderCalc();
}
function calcKey(c) { return [c.model, c.q, c.h, c.lag, c.spec ? JSON.stringify(c.spec) : ""].join("|"); }
function computeCalc() {
  var c = S.calc, key = calcKey(c);
  if (c.key === key && (c.W || c.err)) { drawCalc(); return; }
  c.key = key; c.W = null; c.err = null; c.track = null;
  loadEcon().then(function (E) {
    setTimeout(function () {
      if (c.key !== key) return;
      var t0 = Date.now();
      try {
        var o = { quarter: c.q, horizon: c.h, lagMode: c.lag }, W;
        if (c.spec) W = E.workings.spec(c.spec, PANEL, o);
        else if (POOL[c.model]) {
          W = E.workings.fromRows({ name: c.model, rows: predObjRows(), members: E.engine.COMBO_POOL, weights: POOL[c.model], target: c.q, horizon: c.h, lagMode: c.lag, training: trainingRule(), labelOf: label });
          var oo = E.workings.resolveOrigin(getCtx(E), o); W.origin.date = oo.date; W.origin.month = E.calendar.monthISO(oo.month);
          var aq = PANEL.quarterly.quarters.indexOf(c.q); W.actual = aq >= 0 ? PANEL.quarterly.gdp_real_yoy_pct[aq] : null;
        }
        else W = E.workings.explain(c.model, getCtx(E), o, { labelOf: label });
        if (!W.ok) throw new Error((W.errors || []).map(function (x) { return (x.path ? x.path + ": " : "") + x.message; }).join("; ") || "failed");
        W.ms = Date.now() - t0; W.econ = E.version;
        c.W = W;
      } catch (e) { c.err = e && e.message ? e.message : String(e); }
      if (S.sub !== "calc" || c.key !== key) return;
      drawCalc();
      if (c.W) setTimeout(function () {
        if (c.key !== key) return;
        try { c.track = trackRecord(E, c); } catch (e) { c.track = { err: e && e.message ? e.message : String(e) }; }
        if (S.sub === "calc" && c.key === key) drawTrack();
      }, 20);
    }, 30);
  }, function (e) { c.err = e.message; drawCalc(); });
}
function publishedValue(c) {
  if (c.spec) return null;
  var idx = predIndex()[c.model];
  if (idx) { var r = idx[c.q + "|" + c.h + "|" + c.lag]; if (r && r[0] != null) return r[0]; }
  if (c.q === NC.target.quarter && c.h === NC.target.stage) return currentValue(c.model, c.lag);
  return null;
}
/* decimals per column: as many as the values need (shortest representation), at most 6 */
function colDecimals(rows, ncol) {
  var dec = [];
  for (var j = 0; j < ncol; j++) {
    var d = 0;
    for (var i = 0; i < rows.length && d < 6; i++) {
      var v = rows[i][j];
      if (typeof v !== "number" || !isFinite(v) || Number.isInteger(v)) continue;
      var s = String(v);
      d = Math.max(d, s.indexOf("e") >= 0 ? 6 : Math.min(6, (s.split(".")[1] || "").length));
    }
    dec.push(d);
  }
  return dec;
}
function cellNum(v, d) {
  if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "–";
  var a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e8) && !Number.isInteger(v)) return v.toExponential(4);
  return v.toFixed(d);
}
function blockTable(b, total) {
  var dec = colDecimals(b.rows, b.columns.length);
  var t = '<div class="tablewrap" style="max-height:420px"><table class="data' + (b.kind === "kv" ? " plain" : "") + '"><thead><tr>' + b.columns.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>";
  b.rows.forEach(function (r) {
    t += "<tr>" + r.map(function (v, i) {
      if (typeof v === "number") return "<td>" + esc(cellNum(v, b.kind === "kv" ? (Number.isInteger(v) ? 0 : 6) : dec[i])) + "</td>";
      if (v == null || v === "") return "<td>–</td>";
      return i === 0 ? "<td>" + esc(v) + "</td>" : '<td style="text-align:left;white-space:normal;min-width:120px">' + esc(v) + "</td>";
    }).join("") + "</tr>";
  });
  if (total) t += '<tr class="total">' + total.map(function (v, i) { return "<td>" + esc(i === 0 ? v : typeof v === "number" ? cellNum(v, 6) : v) + "</td>"; }).join("") + "</tr>";
  return t + "</tbody></table></div>";
}
function blockHTML(b) {
  var big = b.rows.length * b.columns.length > 160 && ["design", "coef", "fit", "members", "conditioning", "candidates"].indexOf(b.id) < 0;
  return '<details class="calc-blk"' + (big ? "" : " open") + "><summary>" + esc(b.title) + " <span>· " + esc(tr("calc_rows", { n: b.rows.length })) + "</span></summary>" + (b.note ? '<p class="note info">' + esc(b.note) + "</p>" : "") + blockTable(b) + "</details>";
}
function drawCalc() {
  var out = document.getElementById("calc-out"); if (!out) return;
  var c = S.calc, W = c.W;
  if (c.err) { out.innerHTML = '<p class="note">' + esc(c.err) + "</p>"; return; }
  if (!W) { out.innerHTML = '<p class="muted">' + esc(tr("calc_computing")) + "</p>"; return; }
  var o = W.origin, lagTxt = tr(o.lagMode === "conservative" ? "lag_conservative" : "lag_standard").toLowerCase();
  var h = '<div class="nchead"><h2>' + esc(tr("calc_title", { m: c.spec ? labName({ model: c.model, spec: c.spec }) : label(W.model) })) + '</h2><p class="muted">' + esc(tr("calc_origin", { q: o.period, h: o.horizon, l: lagTxt, d: o.date ? fmtDate(o.date) : "–" })) + " · " + esc((FAMILY[W.model] || W.family || "") + " · " + roleText(isHeadline(W.model) ? "headline" : (ROLE[W.model] || W.role || "model"))) + "</p></div>";
  var pub = publishedValue(c), kp = "";
  if (W.actual != null) kp += kpi(tr("calc_actual", { q: o.period }), pct(W.actual, 2), tr("calc_error") + ": " + nf(W.actual - W.value, 2));
  if (W.n_train != null) kp += kpi(tr("calc_ntrain"), String(W.n_train), "");
  h += '<div class="nchero"><div class="nchl"><span class="muted">' + esc(tr("nowcast_now", { q: o.period })) + '</span><div class="ncbig" style="font-size:44px">' + esc(pct(W.value, 2)) + '</div><div class="mono muted">' + esc(fnum(W.value, 9)) + "</div>" +
    (pub != null && W.value != null ? '<div style="font-size:12.5px;margin-top:4px">' + esc(tr("calc_check", { v: fnum(pub, 6), d: Math.abs(pub - W.value).toExponential(1) })) + "</div>" : "") + '</div><div class="nckpis">' + kp + "</div></div>";
  if (W.failure) h += '<p class="note">' + esc(tr("calc_failed", { f: W.failure })) + "</p>";
  h += '<div class="actions"><button class="btn primary" id="calc-xlsx">' + esc(tr("calc_xlsx")) + '</button><button class="btn" id="calc-json">' + esc(tr("calc_json")) + "</button></div>";
  // 1. specification
  h += '<section class="calc-sec"><h3>' + esc(tr("calc_spec")) + '</h3><pre class="calc-eq">' + esc(W.equation || "–") + "</pre><ul>" + (W.method || []).map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
  if (W.members && W.members.length) h += '<div><span class="section-title">' + esc(tr("calc_members")) + '</span><div class="calc-list">' + W.members.map(function (m) {
    return '<button class="calc-item" data-calc="' + esc(m.model) + '" data-q="' + esc(o.period) + '" data-h="' + esc(o.horizon) + '" data-lag="' + esc(o.lagMode) + '"><b>' + esc(label(m.model)) + "</b><span>" + esc(pct(m.value, 2)) + (m.weight ? " × " + fnum(m.weight, 4) : "") + "</span></button>";
  }).join("") + "</div></div>";
  h += "</section>";
  // 2. variables
  var rr = PANEL.release_rule || {};
  h += '<section class="calc-sec"><h3>' + esc(tr("calc_vars")) + "</h3>";
  if (W.family === "combination") h += '<p class="muted" style="font-size:13px;margin:0">' + esc(tr("calc_vars_combo")) + "</p>";
  else {
    h += '<p class="muted" style="font-size:13px;margin:0">' + esc(tr("calc_vars_note", { d: o.date ? fmtDate(o.date) : o.period, l: lagTxt, r: o.lagMode === "conservative" ? rr.conservative || "" : rr.standard || "" })) + "</p>";
    h += '<div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("v_variable")) + '</th><th style="text-align:left">' + esc(tr("v_role")) + '</th><th style="text-align:left">' + esc(tr("v_transform")) + "</th><th>" + esc(tr("v_lag")) + "</th><th>" + esc(tr("v_due")) + "</th><th>" + esc(tr("v_usable")) + "</th><th>" + esc(tr("v_inhub")) + '</th><th style="text-align:left">' + esc(tr("v_used")) + '</th><th style="text-align:left">' + esc(tr("v_source")) + "</th></tr></thead><tbody>";
    (W.variables || []).forEach(function (v) {
      var pv = varByField(v.field) || {}, tf = pv.transform || v.transform || "";
      h += "<tr><td>" + esc(pv.name || v.name) + '<div class="muted mono" style="font-size:11px">' + esc(v.field) + '</div></td><td style="text-align:left">' + esc(tr(v.role === "target" ? "v_target" : "v_predictor")) + '</td><td style="white-space:normal;min-width:220px;text-align:left">' + esc(tf) + (TRANSFORM_DOC[tf] ? '<div class="muted" style="font-size:11.5px">' + esc(TRANSFORM_DOC[tf]) + "</div>" : "") + (pv.unit ? '<div class="muted" style="font-size:11.5px">' + esc(pv.unit) + "</div>" : "") + "</td><td>" + (v.lag_days == null ? "–" : v.lag_days) + "</td><td>" + esc(v.rule_cutoff || "–") + "</td><td>" + esc(v.last_usable || "–") + "</td><td>" + esc(v.last_in_data || (v.role === "target" ? PANEL.quarterly.quarters[PANEL.quarterly.quarters.length - 1] : "–")) + '</td><td style="white-space:normal;min-width:200px;text-align:left">' + esc(v.used || "") + '</td><td style="text-align:left">' + (pv.hub_sources || []).map(function (s) { return '<button class="linkbtn mono" data-ds="' + esc(s.dataset) + '">' + esc(s.dataset) + "</button>"; }).join("<br>") + "</td></tr>";
    });
    h += "</tbody></table></div>";
  }
  h += "</section>";
  // 3. estimation
  var est = (W.blocks || []).filter(function (b) { return b.id !== "fitted" && !b.excelOnly; });
  h += '<section class="calc-sec"><h3>' + esc(tr("calc_est")) + "</h3>" + (est.length ? est.map(blockHTML).join("") : '<p class="muted">–</p>') + "</section>";
  // 4. term by term
  if (W.terms) {
    h += '<section class="calc-sec"><h3>' + esc(tr("calc_terms")) + "</h3>" + (W.terms.note ? '<p class="note info">' + esc(W.terms.note) + "</p>" : "") +
      blockTable({ columns: W.terms.columns, rows: W.terms.rows }, [tr("calc_total"), "", "", "", W.terms.total]) + "</section>";
  }
  // 5. fitted
  var fb = (W.blocks || []).filter(function (b) { return b.id === "fitted"; })[0];
  if (fb) h += '<section class="calc-sec"><h3>' + esc(tr("calc_fit")) + '</h3><div class="chart-box" id="calc-fchart"></div><div id="calc-fleg"></div>' + blockHTML(fb) + "</section>";
  // 6. track record
  h += '<section class="calc-sec"><h3>' + esc(fb ? tr("calc_track", { h: o.horizon, l: lagTxt }) : tr("calc_track", { h: o.horizon, l: lagTxt }).replace(/^6\./, "5.")) + '</h3><div id="calc-track"><p class="muted">' + esc(tr("calc_computing")) + "</p></div></section>";
  out.innerHTML = h;
  if (fb) {
    var labs = fb.rows.map(function (r) { return r[0]; }), s1 = { name: tr("actual"), color: 0, width: 3, values: fb.rows.map(function (r) { return r[1]; }) }, s2 = { name: label(W.model), color: 1, values: fb.rows.map(function (r) { return r[2]; }) };
    drawLine("calc-fchart", { labels: labs, series: [s1, s2] }); document.getElementById("calc-fleg").innerHTML = legendHTML([s1, s2]);
  }
  bindCalc(out);
  Array.prototype.forEach.call(out.querySelectorAll("[data-ds]"), function (b) { b.onclick = function () { var id = b.getAttribute("data-ds"); if (H.byId(id)) H.openDataset(id); }; });
  document.getElementById("calc-xlsx").onclick = calcXlsx;
  document.getElementById("calc-json").onclick = function () { H.save(calcFile("json"), JSON.stringify({ workings: c.W, track_record: c.track }, null, 1)); };
  if (c.track) drawTrack();
}
function trackRecord(E, c) {
  var h = c.h, lag = c.lag, quarters = PANEL.quarterly.quarters, last = quarters[quarters.length - 1], rows = [], src = "published";
  var idx = c.spec ? null : predIndex()[c.model];
  if (idx) Object.keys(idx).forEach(function (k) { var p = k.split("|"); if (p[1] === h && p[2] === lag) rows.push({ q: p[0], pred: idx[k][0], actual: idx[k][1] }); });
  else if (c.spec) {
    var r = E.runSpec(Object.assign({}, c.spec, { origin: undefined, evaluation: { from: recordFirst(), to: last, horizons: [h], lagMode: lag, benchmark: false } }), PANEL);
    if (!r.ok) throw new Error((r.errors || []).map(function (x) { return x.message; }).join("; "));
    rows = r.accuracy.predictions.map(function (p) { return { q: p.period, pred: p.prediction, actual: p.actual }; }); src = "computed";
  } else {
    var ctx = getCtx(E), m = E.engine.modelByName(ctx, c.model);
    if (!m) throw new Error("unknown model " + c.model);
    var ev = E.evaluate(ctx, [m], { from: recordFirst(), to: last, horizons: [h], lagModes: [lag], benchmark: false });
    rows = ev.predictions.filter(function (p) { return p.model === m.name; }).map(function (p) { return { q: p.target, pred: p.prediction, actual: p.actual }; }); src = "computed";
  }
  var ar = predIndex().ar2 || {};
  rows = rows.filter(function (r) { return r.q >= recordFirst(); });
  rows.forEach(function (r) { var a = ar[r.q + "|" + h + "|" + lag]; r.ar2 = a ? a[0] : null; if ((r.actual == null || isNaN(r.actual)) && a) r.actual = a[1]; if (r.pred != null && isNaN(r.pred)) r.pred = null; });
  if (c.W && c.q === NC.target.quarter && !rows.some(function (r) { return r.q === c.q; })) rows.push({ q: c.q, pred: c.W.value, actual: null, ar2: (ar[c.q + "|" + h + "|" + lag] || [null])[0] });
  rows.sort(function (a, b) { return a.q < b.q ? -1 : a.q > b.q ? 1 : 0; });
  var k0 = 0; while (k0 < rows.length && rows[k0].pred == null && rows[k0].q !== c.q) k0++;   // from the model's first nowcast
  rows = rows.slice(k0);
  var e = [], e1 = [], e2 = [];
  rows.forEach(function (r) {
    if (r.actual == null || r.pred == null) return;
    r.err = r.actual - r.pred; e.push(r.err);
    if (r.ar2 != null) { r.ar2err = r.actual - r.ar2; e1.push(r.err); e2.push(r.ar2err); }
  });
  var mae = 0, bias = 0; e.forEach(function (x) { mae += Math.abs(x); bias += x; });
  var dm = c.model === "ar2" && !c.spec ? null : E.stats.dieboldMariano(e1, e2);
  return { rows: rows, src: src, n: e.length, rmse: rmseOf(e), mae: e.length ? mae / e.length : NaN, bias: e.length ? bias / e.length : NaN, rel: e1.length ? rmseOf(e1) / rmseOf(e2) : NaN, dm: dm };
}
function drawTrack() {
  var box = document.getElementById("calc-track"), c = S.calc, t = c.track; if (!box || !t) return;
  if (t.err) { box.innerHTML = '<p class="note">' + esc(t.err) + "</p>"; return; }
  var self = c.model === "ar2" && !c.spec;
  var h = '<p class="muted" style="font-size:12.5px;margin:0">' + esc(tr(t.src === "published" ? "calc_track_src" : "calc_track_cmp")) + "</p>";
  if (t.n) h += '<div class="verdict"><p>' + esc(tr("tr_summary", { n: t.n, r: nf(t.rmse, 3), m: nf(t.mae, 3), b: nf(t.bias, 3), x: nf(t.rel, 2) })) + "</p>" +
    (t.dm && t.dm.pLess != null && !isNaN(t.dm.pLess) ? "<p>" + esc(tr("tr_dm", { s: nf(t.dm.stat, 2), p: nf(t.dm.pLess, 3), v: tr(t.dm.pLess < 0.10 ? "tr_dm_sig" : "tr_dm_not") })) + "</p>" : "") + "</div>";
  h += '<div class="chart-box" id="calc-tchart"></div><div id="calc-tleg"></div>';
  h += '<div class="tablewrap" style="max-height:420px"><table class="data"><thead><tr><th>' + esc(tr("quarter")) + "</th><th>" + esc(tr("actual")) + "</th><th>" + esc(tr("tr_pred")) + "</th><th>" + esc(tr("tr_err")) + "</th>" + (self ? "" : "<th>" + esc(tr("tr_ar2")) + "</th><th>" + esc(tr("tr_ar2err")) + "</th>") + "</tr></thead><tbody>";
  t.rows.slice().reverse().forEach(function (r) { h += "<tr" + (r.q === c.q ? ' class="on"' : "") + "><td>" + esc(r.q) + "</td><td>" + nf(r.actual, 2) + "</td><td>" + nf(r.pred, 3) + "</td><td>" + nf(r.err, 3) + "</td>" + (self ? "" : "<td>" + nf(r.ar2, 3) + "</td><td>" + nf(r.ar2err, 3) + "</td>") + "</tr>"; });
  box.innerHTML = h + "</tbody></table></div>";
  var labs = t.rows.map(function (r) { return r.q; });
  var ser = [{ name: tr("actual"), color: 0, width: 3, values: t.rows.map(function (r) { return r.actual; }) }, { name: c.spec ? c.model : label(c.model), color: 1, values: t.rows.map(function (r) { return r.pred; }) }];
  if (!self) ser.push({ name: "AR(2)", color: 3, dash: "4 4", values: t.rows.map(function (r) { return r.ar2; }) });
  drawLine("calc-tchart", { labels: labs, series: ser }); document.getElementById("calc-tleg").innerHTML = legendHTML(ser);
}
function calcFile(ext) { var W = S.calc.W, o = W.origin; return ("calculations_" + W.model + "_" + o.period + "_" + o.horizon + "_" + o.lagMode).replace(/[^A-Za-z0-9_.-]+/g, "_") + "." + ext; }
function calcXlsx() {
  var c = S.calc, W = c.W; if (!W) return;
  if (!H.xlsx) { H.toast("Excel export is not available"); return; }
  H.xlsx(function () {
    var X = window.XLSX, wb = X.utils.book_new(), used = {};
    var cell = function (v) { return v === null || v === undefined || (typeof v === "number" && !isFinite(v)) ? null : v; };
    function sheet(name, aoa) {
      var n = String(name).replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet", base = n, i = 2;
      while (used[n.toLowerCase()]) { n = base.slice(0, 27) + " (" + i++ + ")"; }
      used[n.toLowerCase()] = 1;
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa.map(function (r) { return r.map(cell); })), n);
    }
    var o = W.origin, pub = publishedValue(c);
    var sum = [["IMRS Data Hub: workings of one GDP nowcast"], [], ["Model", c.spec ? c.model : label(W.model)], ["Model id", W.model], ["Family", FAMILY[W.model] || W.family], ["Role", roleText(isHeadline(W.model) ? "headline" : (ROLE[W.model] || W.role || "model"))],
      ["Target quarter", o.period], ["Stage", o.horizon], ["Release lags", o.lagMode], ["Forecast origin", o.date || ""], ["Nowcast, % y/y", W.value], ["Published by the fortnightly run", pub],
      ["Official GDP growth (if published)", W.actual], ["Training rows", W.n_train], ["Equation", W.equation]].concat((W.method || []).map(function (m, i) { return ["Method " + (i + 1), m]; }),
      [[], ["Data as of", NC.as_of], ["Computed", new Date().toISOString()], ["Engine", "econ.js " + (W.econ || "")], ["Spec", c.spec ? JSON.stringify(c.spec) : ""]]);
    sheet("Summary", sum);
    sheet("Variables", [["Field", "Name", "Role", "Transformation", "Release lag, days", "Latest month due by the rule", "Latest usable", "Latest in the Hub", "Used in this nowcast", "Hub datasets"]].concat((W.variables || []).map(function (v) {
      var pv = varByField(v.field) || {}; return [v.field, pv.name || v.name, v.role, (pv.transform || v.transform || "") + (TRANSFORM_DOC[pv.transform] ? ": " + TRANSFORM_DOC[pv.transform] : ""), v.lag_days, v.rule_cutoff, v.last_usable, v.last_in_data, v.used, (pv.hub_sources || []).map(function (s) { return s.dataset + (s.key ? " [" + s.key + "]" : ""); }).join("; ")];
    })));
    if (W.terms) sheet("Nowcast arithmetic", [W.terms.columns].concat(W.terms.rows, [["Nowcast = sum of the contributions", null, null, null, W.terms.total]]));
    (W.blocks || []).forEach(function (b) {
      var nm = SHEET[b.id] || (b.id.indexOf("extq_") === 0 ? "Months " + b.id.slice(5) : b.id.indexOf("ext_") === 0 ? "AR ext " + b.id.slice(4) : b.title);
      sheet(nm, [[b.title]].concat(b.note ? [[b.note]] : [], [[]], [b.columns], b.rows));
    });
    if (c.track && c.track.rows) sheet("Track record", [["Quarter", "Actual", "Nowcast", "Error", "AR(2)", "AR(2) error"]].concat(c.track.rows.map(function (r) { return [r.q, r.actual, r.pred, r.err, r.ar2, r.ar2err]; }),
      [[], ["Quarters", c.track.n], ["RMSE", c.track.rmse], ["MAE", c.track.mae], ["Bias", c.track.bias], ["RMSE / AR(2), same quarters", c.track.rel], ["Diebold-Mariano statistic", c.track.dm ? c.track.dm.stat : null], ["DM p, one-sided (better than AR(2))", c.track.dm ? c.track.dm.pLess : null]]));
    var out = X.write(wb, { bookType: "xlsx", type: "array" });
    H.save(calcFile("xlsx"), new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  });
}

/* ---------------- model lab ---------------- */
var FAMILIES = [
  ["ar", "AR(p)", "y_t = c + Σ φ_j y_(t−j)"],
  ["bridge_ar", "Bridge equations", "GDP on quarterly means of monthly indicators; unreleased months filled by AR forecasts"],
  ["bridge", "Bridge (visible months)", "GDP on the mean of the released months of each indicator only"],
  ["midas", "MIDAS", "U-MIDAS, Almon, exponential-Almon or Beta lag weights on monthly data"],
  ["dfm", "Dynamic factor model (PCA)", "EM-PCA factors from many indicators, GDP on quarterly factors"],
  ["dfm_kalman", "Dynamic factor model (Kalman)", "factors with VAR(1) dynamics, Kalman filter/smoother, ragged edge"],
  ["lasso", "Lasso", "L1-penalised regression, penalty chosen by time-series cross-validation"],
  ["enet", "Elastic Net", "L1+L2 penalty, penalty and mix chosen by time-series cross-validation"],
  ["bvar", "Bayesian VAR", "Minnesota prior; GDP and quarterly aggregates; conditional forecast with bands"],
  ["ensemble", "Ensemble: AR(2) + U-MIDAS", "0.5 × AR(2) + 0.5 × U-MIDAS(3) on one indicator (USD/UZS by default)"]
];
var FAM_OPTS = {
  ar: [["p", "number", 2, "Lags p"]],
  bridge_ar: [],
  bridge: [],
  midas: [["weighting", ["umidas", "almon", "expalmon", "beta"], "umidas", "Lag weights"], ["lags", "number", 3, "Monthly lags K"]],
  dfm: [["factors", "number", 1, "Factors"]],
  dfm_kalman: [["factors", "number", 1, "Factors"]],
  lasso: [["design", ["bridge", "umidas"], "bridge", "Design"]],
  enet: [["design", ["bridge", "umidas"], "bridge", "Design"]],
  bvar: [["lags", "number", 1, "VAR lags"], ["lambda", "number", 0.2, "Prior tightness λ"]],
  ensemble: []
};
var PRED_LIMIT = { ar: [0, 0], ensemble: [0, 0], midas: [1, 1], bridge: [1, 12], bridge_ar: [1, 12], dfm: [2, 60], dfm_kalman: [3, 60], lasso: [1, 60], enet: [1, 60], bvar: [1, 8] };
function labFields() {
  var list = [];
  (PANEL.variables || []).forEach(function (v) { if (v.block !== "Target" && (PANEL.monthly.fields || []).indexOf(v.field) >= 0) list.push({ field: v.field, name: v.name, block: v.block, lag: v.lag_days, tier: v.tier }); });
  S.lab.custom.forEach(function (c) { list.push({ field: c.name, name: c.label, block: "Added from the Hub", lag: c.lagDays, custom: true }); });
  return list;
}
function renderLab() {
  var el = body(), L = S.lab;
  if (!L.from) L.from = recordFirst();
  var fam = L.family, lim = PRED_LIMIT[fam] || [0, 60];
  var h = '<p class="muted">' + esc(tr("lab_intro")) + "</p>";
  h += expPanelHTML();
  h += '<div class="labgrid"><div class="labform panel">';
  h += '<label class="fld">' + esc(tr("lab_family")) + '<select id="lab-fam">' + FAMILIES.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === fam ? " selected" : "") + ">" + esc(f[1]) + "</option>"; }).join("") + '</select><span class="muted" style="font-size:12px">' + esc((FAMILIES.filter(function (f) { return f[0] === fam; })[0] || [])[2] || "") + "</span></label>";
  if (lim[1] > 0) {
    var blocks = {}, order = [];
    labFields().forEach(function (f) { if (!blocks[f.block]) { blocks[f.block] = []; order.push(f.block); } blocks[f.block].push(f); });
    h += '<div class="fld"><span>' + esc(tr("lab_predictors")) + ' <span class="muted">(' + (lim[0] === lim[1] ? lim[0] : lim[0] + "–" + lim[1]) + ')</span></span><div class="predlist">' + order.map(function (b) {
      return '<div class="predblock"><b>' + esc(b) + "</b>" + blocks[b].map(function (f) { return '<label><input type="' + (lim[1] === 1 ? "radio" : "checkbox") + '" name="labp" value="' + esc(f.field) + '"' + (L.predictors.indexOf(f.field) >= 0 ? " checked" : "") + "> " + esc(f.name) + ' <span class="muted mono">' + esc(f.field) + "</span></label>"; }).join("") + "</div>";
    }).join("") + '</div><button class="linkbtn" id="lab-add-toggle">+ ' + esc(tr("lab_add")) + '</button><div id="lab-add" hidden></div></div>';
  }
  var fo = FAM_OPTS[fam] || [];
  if (fo.length) h += '<div class="fld"><span>' + esc(tr("lab_options")) + '</span><div class="optrow">' + fo.map(function (o) {
    var cur = L.options[o[0]] != null ? L.options[o[0]] : o[2];
    if (Array.isArray(o[1])) return '<label>' + esc(o[3]) + '<select data-opt="' + o[0] + '">' + o[1].map(function (x) { return '<option' + (x === cur ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select></label>";
    return '<label>' + esc(o[3]) + '<input data-opt="' + o[0] + '" type="number" step="any" value="' + esc(cur) + '"></label>';
  }).join("") + "</div></div>";
  if (fam !== "ensemble") h += '<label class="fld">' + esc(tr("lab_form")) + '<select id="lab-form">' + [["auto", tr("lab_form_auto")], ["quarter", tr("lab_form_quarter")], ["ytd", tr("lab_form_ytd")]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === (L.form || "auto") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
  var qs = PANEL.quarterly.quarters.filter(function (q) { return q >= recordFirst(); });
  h += '<div class="fld"><span>' + esc(tr("lab_eval")) + '</span><div class="optrow"><label>' + esc(tr("lab_from")) + '<select id="lab-from">' + qs.map(function (q) { return "<option" + (q === L.from ? " selected" : "") + ">" + q + "</option>"; }).join("") + '</select></label><label>' + esc(tr("lag")) + '<select id="lab-lag"><option value="standard"' + (L.lagMode === "standard" ? " selected" : "") + ">" + esc(tr("lag_standard")) + '</option><option value="conservative"' + (L.lagMode === "conservative" ? " selected" : "") + ">" + esc(tr("lag_conservative")) + "</option></select></label></div></div>";
  h += '<div class="ask-row"><button class="btn primary" id="lab-run"' + (L.running ? " disabled" : "") + ">" + esc(tr("lab_run")) + '</button><span class="ask-status" id="lab-status"></span></div>';
  h += '</div><div class="labout" id="lab-out"></div></div>';
  h += '<div class="panel labai"><h3 class="section-title">' + esc(tr("lab_ai")) + '</h3><textarea id="lab-ai-q" placeholder="' + esc(tr("lab_ai_ph")) + '">' + esc(L.ai.q) + '</textarea><div class="ask-row"><button class="btn" id="lab-ai-go">' + esc(tr("lab_ai_btn")) + '</button><button class="btn" id="lab-ai-stop" hidden>' + esc(tr("stop")) + '</button><span class="ask-status" id="lab-ai-status"></span></div><div class="answer" id="lab-ai-out"' + (L.ai.text ? "" : " hidden") + ">" + esc(L.ai.text) + '</div><p class="muted" style="margin:0;font-size:12.5px">' + (H.sample() ? esc(tr("lab_ai_note")) : H.native ? esc(tr("lab_ai_native")) + ' <a class="btn" href="' + esc(H.claudeLink("nowcast/lab")) + '" target="_blank" rel="noopener">' + esc(tr("in_claude")) + "</a>" : esc(tr("lab_ai_off"))) + "</p></div>";
  el.innerHTML = h;
  document.getElementById("lab-fam").onchange = function (e) { L.family = e.target.value; L.options = {}; L.name = null; var lm = PRED_LIMIT[L.family] || [0, 60]; if (lm[1] === 1) L.predictors = L.predictors.slice(0, 1).concat(L.predictors.length ? [] : ["usd_uzs_mom_dlog"]).slice(0, 1); if (lm[1] === 0) L.predictors = []; if (L.predictors.length < lm[0]) L.predictors = (PANEL.model_fields || []).slice(0, Math.max(lm[0], Math.min(6, lm[1]))); renderLab(); };
  Array.prototype.forEach.call(el.querySelectorAll('input[name="labp"]'), function (c) { c.onchange = function () { L.name = null; L.predictors = Array.prototype.map.call(el.querySelectorAll('input[name="labp"]:checked'), function (x) { return x.value; }); }; });
  Array.prototype.forEach.call(el.querySelectorAll("[data-opt]"), function (c) { c.onchange = function () { L.name = null; var v = c.type === "number" ? parseFloat(c.value) : c.value; L.options[c.getAttribute("data-opt")] = v; }; });
  document.getElementById("lab-from").onchange = function (e) { L.from = e.target.value; };
  var lf = document.getElementById("lab-form"); if (lf) lf.onchange = function (e) { L.form = e.target.value; L.name = null; };
  document.getElementById("lab-lag").onchange = function (e) { L.lagMode = e.target.value; };
  document.getElementById("lab-run").onclick = function () { runLab(); };
  var at = document.getElementById("lab-add-toggle"); if (at) at.onclick = function () { var box = document.getElementById("lab-add"); box.hidden = !box.hidden; if (!box.hidden) renderAddSeries(); };
  document.getElementById("lab-ai-go").onclick = runLabAI;
  document.getElementById("lab-ai-stop").onclick = function () { if (L.ai.ctl) L.ai.ctl.abort(); };
  if (!H.sample()) document.getElementById("lab-ai-go").disabled = true;
  bindExp(el);
  showLabResult();
}
function labSpec(extra) {
  var L = S.lab, spec = { family: L.family, options: {}, evaluation: { from: L.from || recordFirst(), horizons: ["H1", "H2", "H3"], lagMode: L.lagMode, windows: labWindows() } };
  if (L.name) spec.name = L.name;
  var lim = PRED_LIMIT[L.family] || [0, 60];
  if (lim[1] > 0) spec.predictors = L.predictors.slice(0, lim[1]);
  (FAM_OPTS[L.family] || []).forEach(function (o) { var v = L.options[o[0]]; if (v != null && v !== "" && !(typeof v === "number" && isNaN(v))) spec.options[o[0]] = v; });
  if (L.form && L.form !== "auto" && L.family !== "ensemble") spec.form = L.form;
  if (S.lab.custom.length) spec.series = S.lab.custom.map(function (c) { return { name: c.name, periods: c.periods, values: c.values, transform: c.transform, lagDays: c.lagDays }; });
  if (extra) for (var k in extra) spec[k] = extra[k];
  return spec;
}
function runLab(spec) {
  var L = S.lab; spec = spec || labSpec();
  var st = document.getElementById("lab-status");
  L.running = true; if (st) st.textContent = tr("lab_running", { m: spec.family });
  var btn = document.getElementById("lab-run"); if (btn) btn.disabled = true;
  return loadEcon().then(function (E) {
    return new Promise(function (res) { setTimeout(function () { var t0 = Date.now(); var r = E.runSpec(spec, PANEL); r.elapsed = Date.now() - t0; res(r); }, 30); });
  }).then(function (r) {
    L.running = false; L.result = r; L.lastSpec = spec;
    var st2 = document.getElementById("lab-status"); if (st2) st2.textContent = r.ok ? (r.elapsed / 1000).toFixed(1) + " s" : "";
    var b2 = document.getElementById("lab-run"); if (b2) b2.disabled = false;
    showLabResult();
    return r;
  }, function (e) {
    L.running = false; var st2 = document.getElementById("lab-status"); if (st2) st2.textContent = e.message;
    var b2 = document.getElementById("lab-run"); if (b2) b2.disabled = false;
    throw e;
  });
}
/* Readable name of a model built in the lab: its published label, else family + indicators. */
function labName(r) {
  if (!r) return "";
  if (LABEL[r.model]) return LABEL[r.model];
  var sp = r.spec || {}, fam = (FAMILIES.filter(function (x) { return x[0] === sp.family; })[0] || [])[1] || sp.family || "";
  var preds = (sp.predictors || []).map(function (f) { var v = varByField(f); return v ? v.name : f; });
  if (!fam) return r.model || "";
  return preds.length ? fam + ": " + (preds.length <= 2 ? preds.join(", ") : preds.length + " indicators") : fam;
}
function testWindow() { var t = (NC.accuracy.windows || {}).test || []; return t.length ? { test: [t[0], t[t.length - 1]] } : {}; }
/* Lab accuracy windows besides the whole evaluation: the test period and the published evaluation window ("main"). */
function labWindows() { var w = testWindow(), a = (NC.accuracy.windows || {}).all || []; if (a.length) w.main = [a[0], a[a.length - 1]]; return w; }
function accRows(r, win) {
  var acc = r.accuracy && r.accuracy.windows && r.accuracy.windows[win];
  return acc || [];
}
function showLabResult() {
  var out = document.getElementById("lab-out"); if (!out) return;
  var r = S.lab.result;
  if (!r) { out.innerHTML = '<div class="panel" style="padding:18px"><p class="muted" style="margin:0">' + esc(tr("lab_none")) + "</p></div>"; return; }
  if (!r.ok) { out.innerHTML = '<div class="panel" style="padding:18px"><p class="note">' + (r.errors || []).map(function (e) { return esc((e.path ? e.path + ": " : "") + e.message); }).join("<br>") + "</p></div>"; return; }
  var nc = r.nowcast || {}, h = '<div class="panel labres"><h3 class="section-title">' + esc(tr("lab_result")) + " · " + esc(labName(r)) + "</h3>";
  if (nc.failure || nc.value == null || isNaN(nc.value)) h += '<p class="note">' + esc(tr("lab_failure", { f: nc.failure || "no value" })) + "</p>";
  else h += '<div class="nchero" style="margin:0"><div class="nchl"><span class="muted">' + esc(tr("nowcast_now", { q: nc.period })) + " · " + esc(nc.horizon) + " · " + esc(nc.lagMode) + '</span><div class="ncbig" style="font-size:40px">' + esc(pct(nc.value, 2)) + "</div>" + (nc.band68 ? '<div class="muted">68%: ' + nf(nc.band68[0]) + " – " + nf(nc.band68[1]) + (nc.band90 ? " · 90%: " + nf(nc.band90[0]) + " – " + nf(nc.band90[1]) : "") + "</div>" : "") + '<div class="muted">' + esc(tr("headline")) + " (" + esc(label(headlineId())) + "): " + esc(pct(NC.headline.value, 2)) + "</div></div></div>";
  (r.warnings || []).forEach(function (w) { h += '<p class="note info">' + esc(typeof w === "string" ? w : JSON.stringify(w)) + "</p>"; });
  var all = accRows(r, "all"), ho = accRows(r, "test"), mn = accRows(r, "main");
  var same = all.length && mn.length && all[0].first === mn[0].first && all[0].last === mn[0].last;
  if (all.length) {
    h += '<h3 class="section-title">' + esc(tr("lab_acc")) + '</h3><div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("window")) + "</th><th>" + esc(tr("horizon")) + "</th><th>N</th><th>RMSE</th><th>MAE</th><th>Bias</th><th>" + esc(tr("rel_ar2")) + "</th></tr></thead><tbody>";
    [["all", all], ["main", same ? [] : mn], ["test", ho]].forEach(function (w) { w[1].forEach(function (m) { var rel = m.rmse_rel_ar2, cls = rel == null ? "" : rel < 0.95 ? "ok" : rel > 1.05 ? "bad" : ""; h += "<tr><td>" + esc(w[0] === "all" ? (m.first || "") + "–" + (m.last || "") : w[0] === "main" ? tr("lab_win_main", { a: winSpan("all")[0], b: winSpan("all")[1] }) : tr("win_test", { a: winSpan("test")[0], b: winSpan("test")[1] })) + "</td><td>" + esc(m.horizon === "pooled" ? tr("pooled") : m.horizon) + "</td><td>" + m.N + "</td><td>" + nf(m.rmse, 3) + "</td><td>" + nf(m.mae, 3) + "</td><td>" + nf(m.bias, 3) + '</td><td><span class="badge ' + cls + '">' + nf(rel, 2) + "</span></td></tr>"; }); });
    h += "</tbody></table></div>";
  }
  h += '<h3 class="section-title">' + esc(tr("lab_chart", { h: "H3" })) + '</h3><div class="chart-box" id="lab-chart"></div><div id="lab-leg"></div>';
  var co = r.coefficients || {};
  if (Object.keys(co).length) h += '<details class="meta"><summary>' + esc(tr("lab_coef")) + " (" + Object.keys(co).length + ')</summary><div class="tablewrap" style="max-height:300px"><table class="data"><tbody>' + Object.keys(co).slice(0, 200).map(function (k) { var v = co[k]; return "<tr><td class=\"mono\">" + esc(k) + "</td><td>" + (typeof v === "number" ? nf(v, 4) : esc(JSON.stringify(v))) + "</td></tr>"; }).join("") + "</tbody></table></div></details>";
  h += '<div class="actions"><button class="btn primary" id="lab-calc">ƒx ' + esc(tr("calc_btn")) + '</button><button class="btn" id="lab-save">' + esc(tr("lab_save")) + '</button><button class="btn" id="lab-csv">' + esc(tr("lab_csv")) + "</button></div></div>";
  out.innerHTML = h;
  document.getElementById("lab-calc").onclick = function () { var sp = S.lab.lastSpec || {}; openCalc(r.model, { spec: sp, q: nc.period, h: nc.horizon, lag: nc.lagMode }); };
  var preds = (r.accuracy && r.accuracy.predictions) || [], byQ = {}, qs = [];
  preds.forEach(function (p) { if (p.horizon !== "H3") return; if (!byQ[p.period]) { byQ[p.period] = p; qs.push(p.period); } });
  qs.sort();
  if (nc.value != null && !isNaN(nc.value) && qs.indexOf(nc.period) < 0) { qs.push(nc.period); byQ[nc.period] = { prediction: nc.value, actual: null }; }
  var ser = [{ name: tr("actual"), color: 0, width: 3, values: qs.map(function (q) { return byQ[q].actual; }) }, { name: r.model, color: 1, values: qs.map(function (q) { return byQ[q].prediction; }) }];
  drawLine("lab-chart", { labels: qs, series: ser }); document.getElementById("lab-leg").innerHTML = legendHTML(ser);
  document.getElementById("lab-save").onclick = function () {
    S.runs.push({ id: "run" + (S.runs.length + 1), model: r.model, family: r.family, spec: S.lab.lastSpec, nowcast: nc, accuracy: { all: all, test: ho }, preds: qs.map(function (q) { return [q, byQ[q].actual, byQ[q].prediction]; }) });
    H.toast(tr("lab_saved"));
  };
  document.getElementById("lab-csv").onclick = function () {
    var lines = ["period,horizon,lag_mode,prediction,actual,error"];
    preds.forEach(function (p) { lines.push([p.period, p.horizon, p.lagMode, p.prediction, p.actual, p.error].join(",")); });
    H.save(r.model + "_forecasts.csv", lines.join("\n"), "text/csv");
  };
}
/* Experimental models: status, comparison with the same model without the new data, and a lab preset. */
function expRow(ex, win, lag, hz) { var x = null; (ex.comparison || []).forEach(function (r) { if (r.window === win && r.lag_mode === lag && r.horizon === hz) x = r; }); return x; }
function expPanelHTML() {
  var xs = NC.experimental || [];
  if (!xs.length) return "";
  var T = NC.target, h = '<div class="panel labres"><h3 class="section-title">' + esc(tr("lab_exp_title")) + '</h3><p class="muted" style="margin:0;font-size:13px">' + esc(tr("lab_exp_intro")) + "</p>";
  xs.forEach(function (ex, i) {
    var cur = modelRow(ex.model) || {}, base = modelRow(ex.baseline) || {};
    h += '<div style="display:grid;gap:10px;border-top:1px solid var(--rule);padding-top:12px"><div><b>' + esc(label(ex.model).replace(/, experimental$/, "")) + '</b> <span class="badge warn">' + esc(roleText("experimental")) + '</span><div class="muted" style="font-size:12.5px">' + esc(tr("lab_exp_added", { d: fmtDate(ex.added), b: label(ex.baseline), t: ex.trial_from, n: ex.trial_quarters, r: ex.review_after })) + "</div></div>";
    var all = expRow(ex, "all", "standard", "pooled"), tst = expRow(ex, "test", "standard", "pooled"), trl = expRow(ex, "trial", "standard", "pooled");
    h += '<div class="nckpis">' + kpi(tr("nowcast_now", { q: T.quarter }) + " · " + T.stage, pct(cur.value, 2), tr("lab_exp_base") + ": " + pct(base.value, 2));
    if (all && all.N) h += kpi(tr("win_all", { a: all.first, b: all.last }), "RMSE " + nf(all.rmse, 3), tr("lab_exp_base") + ": " + nf(all.rmse_baseline, 3));
    if (tst && tst.N) h += kpi(tr("win_test", { a: tst.first, b: tst.last }), "RMSE " + nf(tst.rmse, 3), tr("lab_exp_base") + ": " + nf(tst.rmse_baseline, 3));
    h += "</div>";
    if (!trl || !trl.N) h += '<p class="note info" style="margin:0">' + esc(tr("lab_exp_empty", { q: ex.trial_from })) + "</p>";
    h += '<div class="actions"><button class="btn primary" data-exp-run="' + i + '">' + esc(tr("lab_exp_run")) + "</button>" + calcButton(ex.model) + "</div>";
    h += '<details class="meta"' + (i === 0 && window.innerWidth >= 900 ? " open" : "") + '><summary>' + esc(tr("lab_exp_cmp", { b: label(ex.baseline) })) + '</summary><div style="display:grid;gap:10px;margin-top:6px"><div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("window")) + "</th><th>" + esc(tr("lag")) + "</th><th>N</th><th>RMSE</th><th>" + esc(tr("lab_exp_base_rmse")) + "</th><th>" + esc(tr("lab_exp_ratio")) + "</th><th>" + esc(tr("lab_exp_better")) + "</th></tr></thead><tbody>";
    ["trial", "test", "selection", "all", "record"].forEach(function (w) {
      ["standard", "conservative"].forEach(function (lag) {
        var r = expRow(ex, w, lag, "pooled"); if (!r) return;
        var wl = w === "trial" ? tr("win_trial", { a: ex.trial_from }) : tr("win_" + w, { a: r.first || "", b: r.last || "" });
        h += "<tr><td>" + esc(wl) + "</td><td>" + esc(tr(lag === "standard" ? "lag_standard" : "lag_conservative")) + "</td><td>" + r.N + "</td><td>" + nf(r.rmse, 3) + "</td><td>" + nf(r.rmse_baseline, 3) + "</td><td>" + (r.N ? relBadge(r.rel) : "–") + "</td><td>" + (r.N ? r.better + " / " + r.N : "–") + "</td></tr>";
      });
    });
    h += "</tbody></table></div>";
    var lt = ex.latest;
    if (lt && lt.stages && lt.stages.length) h += '<p class="muted" style="margin:0;font-size:12.5px">' + esc(tr("lab_exp_latest", { q: lt.quarter, e: lt.stages.map(function (s) { return s.horizon + " " + nf(s.error, 2); }).join(" · "), b: lt.stages.map(function (s) { return s.horizon + " " + nf(s.baseline_error, 2); }).join(" · ") })) + "</p>";
    h += '<div><span class="section-title">' + esc(tr("lab_exp_chart", { h: "H3" })) + '</span><div class="chart-box" id="lab-exp-chart-' + i + '"></div><div id="lab-exp-leg-' + i + '"></div></div></div></details>';
    h += '<details class="meta"><summary>' + esc(tr("lab_exp_rule")) + '</summary><p style="font-size:13px">' + esc(ex.rule || "") + '</p><p style="font-size:13px">' + esc(ex.evidence || "") + '</p><p class="muted" style="font-size:12.5px">' + esc(ex.spec || "") + "</p></details></div>";
  });
  return h + "</div>";
}
function bindExp(root) {
  (NC.experimental || []).forEach(function (ex, i) {
    if (!document.getElementById("lab-exp-chart-" + i)) return;
    var qs = PANEL.quarterly.quarters.concat(PANEL.quarterly.quarters.indexOf(NC.target.quarter) < 0 ? [NC.target.quarter] : []), gdp = PANEL.quarterly.gdp_real_yoy_pct;
    var pa = predRows(ex.model, "H3", "standard"), pb = predRows(ex.baseline, "H3", "standard");
    var labs = qs.filter(function (q) { return pa[q] != null || pb[q] != null; });
    var ser = [{ name: tr("actual"), color: 0, width: 3, values: labs.map(function (q) { var k = PANEL.quarterly.quarters.indexOf(q); return k >= 0 ? gdp[k] : null; }) },
      { name: shortLabel(ex.model), color: 1, width: 2.5, values: labs.map(function (q) { return pa[q]; }) },
      { name: label(ex.baseline), color: 5, dash: "4 4", values: labs.map(function (q) { return pb[q]; }) }];
    drawLine("lab-exp-chart-" + i, { labels: labs, series: ser }); document.getElementById("lab-exp-leg-" + i).innerHTML = legendHTML(ser);
  });
  Array.prototype.forEach.call(root.querySelectorAll("[data-exp-run]"), function (b) { b.onclick = function () { runExperimental((NC.experimental || [])[+b.getAttribute("data-exp-run")]); }; });
  bindCalc(root);
}
/* Load an experimental model into the lab form (same specification as the fortnightly run) and run it. */
function runExperimental(ex) {
  if (!ex) return;
  loadEcon().then(function (E) {
    var sp = (E.engine.EXPERIMENTAL || {})[ex.model]; if (!sp) return;
    var tf = sp.fields ? sp.fields.slice() : (E.engine.tierFields(getCtx(E))[sp.tier] || []).concat(sp.extra), L = S.lab;
    L.family = sp.family; L.predictors = tf; L.options = { factors: sp.factors }; L.form = "quarter"; L.from = recordFirst(); L.lagMode = "standard"; L.name = ex.model;
    renderLab();
    var out = document.getElementById("lab-out"); if (out && out.scrollIntoView) out.scrollIntoView({ block: "start", behavior: "smooth" });
    return runLab();
  });
}
function renderAddSeries() {
  var box = document.getElementById("lab-add");
  box.innerHTML = '<div class="addser"><input id="lab-q" type="search" placeholder="' + esc(tr("lab_add_ph")) + '"><ul class="addres" id="lab-qres"></ul><div id="lab-pick"></div></div>' + (S.lab.custom.length ? '<div class="muted" style="font-size:12.5px">' + esc(tr("lab_added")) + ": " + S.lab.custom.map(function (c) { return esc(c.label); }).join(", ") + "</div>" : "");
  var q = document.getElementById("lab-q"), tmr;
  q.oninput = function () {
    clearTimeout(tmr); tmr = setTimeout(function () {
      var r = H.searchCatalog(q.value, false, 30).items.filter(function (d) { return d.k === "s" && d.f && /M|Q|D|C|W/.test(d.f); }).slice(0, 10);
      document.getElementById("lab-qres").innerHTML = r.map(function (d) { return '<li><button data-ds="' + esc(d.id) + '">' + esc(H.dsName(d)) + ' <span class="muted mono">' + esc(d.id) + " · " + esc(d.f) + " · " + esc(d.lp || "") + "</span></button></li>"; }).join("");
      Array.prototype.forEach.call(box.querySelectorAll("[data-ds]"), function (b) { b.onclick = function () { pickSeries(b.getAttribute("data-ds")); }; });
    }, 150);
  };
}
var TRANSFORMS = [["decum_yoy_log", "YTD de-cumulated, y/y log growth"], ["yoy_log", "y/y log growth"], ["logdiff", "month-on-month log change"], ["mom_index_log", "100·ln(index/100) (prev. month = 100)"], ["fx_monthly_dlog", "daily → monthly mean, log change"], ["diff", "first difference"], ["none", "as published"]];
function pickSeries(id) {
  var d = H.byId(id), pk = document.getElementById("lab-pick");
  pk.innerHTML = '<p class="muted">' + esc(tr("loading")) + "</p>";
  H.loadShard(d.sh).then(function (sh) {
    var data = sh[id]; if (!data || !data.r) { pk.innerHTML = '<p class="note">No series in this dataset.</p>'; return; }
    var sugg = /-C\d\d$/.test(data.p[data.p.length - 1]) || /cumulative|нараст/i.test(JSON.stringify(data.m.meta || {}).slice(0, 4000)) ? "decum_yoy_log" : d.f === "D" ? "fx_monthly_dlog" : /index|индекс/i.test(pick0(d.n)) ? "mom_index_log" : "yoy_log";
    pk.innerHTML = '<div class="optrow"><label>Series<select id="lab-sk">' + data.r.slice(0, 400).map(function (r, i) { return '<option value="' + i + '">' + esc((r.l && (r.l[0] || r.l[1] || r.l[2])) || r.k) + " (" + esc(r.k) + ")</option>"; }).join("") + '</select></label><label>' + esc(tr("lab_transform")) + '<select id="lab-tf">' + TRANSFORMS.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === sugg ? " selected" : "") + ">" + esc(t[1]) + "</option>"; }).join("") + '</select></label><label>' + esc(tr("lab_lag")) + '<input id="lab-ld" type="number" value="30"></label><button class="btn" id="lab-addbtn">+</button></div>';
    document.getElementById("lab-addbtn").onclick = function () {
      var i = +document.getElementById("lab-sk").value, r = data.r[i], tf = document.getElementById("lab-tf").value, ld = parseInt(document.getElementById("lab-ld").value, 10) || 30;
      var name = (id + "_" + r.k).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48) + "_" + tf;
      S.lab.custom = S.lab.custom.filter(function (c) { return c.name !== name; });
      S.lab.custom.push({ name: name, label: pick0(d.n) + " — " + ((r.l && (r.l[0] || r.l[1])) || r.k), dataset: id, key: r.k, periods: data.p, values: r.v, transform: tf, lagDays: ld });
      if (S.lab.predictors.indexOf(name) < 0) S.lab.predictors.push(name);
      renderLab();
      var box = document.getElementById("lab-add"); if (box) { box.hidden = false; renderAddSeries(); }
    };
  }, function (e) { pk.innerHTML = '<p class="note">' + esc(e.message) + "</p>"; });
}
function pick0(n) { return H.pick(n) || (n && (n[0] || n[1])) || ""; }

/* Claude designs models with the lab's estimators */
function runLabAI() {
  var SAMPLE = H.sample(), L = S.lab, q = (document.getElementById("lab-ai-q").value || "").trim();
  if (!q || !SAMPLE) return;
  L.ai.q = q; L.ai.text = "";
  var out = document.getElementById("lab-ai-out"), st = document.getElementById("lab-ai-status");
  function status(m) { if (st) st.textContent = m; }
  function show(t) { L.ai.text = t; if (out) { out.hidden = false; out.textContent = t; } }
  loadEcon().then(function (E) {
    var schema = E.specSchema(E.data.fromPanel(PANEL));
    var tools = [
      { name: "list_variables", description: "List the predictors available to models: the monthly nowcasting indicators (field, name, block, tier, transform, release lag in days, first/last valid month; the 28 of the nowcasting registry plus the experimental satellite series night-time lights, NDVI and NO2) plus any Hub series already added. The target is real GDP growth published quarterly and cumulated from January (year to date, % vs the same months a year earlier; field gdp_real_yoy_pct).",
        inputSchema: { type: "object", properties: {} },
        execute: function () { status("list_variables"); return { target: { field: "gdp_real_yoy_pct", last_quarter: PANEL.quarterly.quarters[PANEL.quarterly.quarters.length - 1] }, predictors: (PANEL.variables || []).filter(function (v) { return v.block !== "Target"; }).map(function (v) { return { field: v.field, name: v.name, block: v.block, transform: v.transform, lag_days: v.lag_days, first: v.first_valid, last: v.last_valid, tier: v.tier }; }).concat(L.custom.map(function (c) { return { field: c.name, name: c.label, block: "added", transform: c.transform, lag_days: c.lagDays }; })), families: schema.families || schema }; } },
      { name: "search_hub", description: "Search the IMRS Data Hub catalogue for other series that could serve as predictors (monthly or quarterly). Returns dataset ids, names, frequency and coverage.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        execute: function (inp) { status("search_hub: " + inp.query); return H.searchCatalog(String(inp.query || ""), false, 30).items.filter(function (d) { return d.k === "s"; }).slice(0, 12).map(function (d) { return { id: d.id, name: pick0(d.n), frequency: d.f, first: d.fp, last: d.lp, series: d.ns, unit: d.u }; }); } },
      { name: "list_series", description: "List the series (rows) of one Hub dataset with their keys, labels and last value period.",
        inputSchema: { type: "object", properties: { dataset_id: { type: "string" }, filter: { type: "string" } }, required: ["dataset_id"] },
        execute: function (inp) { var d = H.byId(String(inp.dataset_id)); if (!d) throw new Error("unknown dataset"); status("list_series: " + d.id); return H.loadShard(d.sh).then(function (sh) { var x = sh[d.id], f = String(inp.filter || "").toLowerCase(); return { periods: [x.p[0], x.p[x.p.length - 1]], rows: x.r.filter(function (r) { return !f || JSON.stringify(r.l).toLowerCase().indexOf(f) >= 0 || String(r.k).toLowerCase().indexOf(f) >= 0; }).slice(0, 40).map(function (r) { return { key: r.k, label: r.l[0] || r.l[1] || r.l[2] }; }) }; }); } },
      { name: "add_series", description: "Add a Hub series to the lab so models can use it as a predictor. transform: decum_yoy_log (year-to-date cumulative monthly tables, e.g. most SIAT monthly volumes), yoy_log, logdiff, mom_index_log (index, previous month = 100), fx_monthly_dlog (daily rates), diff, none. Returns the field name to use in run_model.",
        inputSchema: { type: "object", properties: { dataset_id: { type: "string" }, key: { type: "string" }, transform: { type: "string" }, lag_days: { type: "number" } }, required: ["dataset_id", "key", "transform"] },
        execute: function (inp) { var d = H.byId(String(inp.dataset_id)); if (!d) throw new Error("unknown dataset"); status("add_series: " + d.id); return H.loadShard(d.sh).then(function (sh) { var x = sh[d.id], r = null; x.r.forEach(function (rr) { if (String(rr.k) === String(inp.key)) r = rr; }); if (!r) throw new Error("unknown key " + inp.key); var tf = String(inp.transform), name = (d.id + "_" + r.k).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48) + "_" + tf; L.custom = L.custom.filter(function (c) { return c.name !== name; }); L.custom.push({ name: name, label: pick0(d.n) + " — " + (r.l[0] || r.l[1] || r.k), dataset: d.id, key: r.k, periods: x.p, values: r.v, transform: tf, lagDays: inp.lag_days || 30 }); return { field: name }; }); } },
      { name: "run_model", description: "Estimate and evaluate a model with the lab's estimators (pseudo-real-time, release lags, expanding window; evaluation from " + recordFirst() + " by default, the start of the Hub's track record; before " + (trainingRule().production_first || "2021Q1") + " models train on the quarters from " + (trainingRule().early_train_start || "2016Q1") + ", from then on the quarters from " + (trainingRule().train_start || "2018Q1") + "; AR(2) benchmark on the same quarters). spec: {family, predictors:[fields], options:{...}, form:'quarter'|'ytd' (optional: quarter = estimated on the growth of the quarter alone and converted to year-to-date growth, the Hub's form for indicator models; ytd = on the published year-to-date growth, the Hub's form for mean, ar and ensemble), evaluation:{from, horizons, lagMode}}. Families and options: " + JSON.stringify(schema.families ? Object.keys(schema.families) : schema).slice(0, 1500) + ". Returns the nowcast for the current quarter and accuracy; the result is also shown to the user.",
        inputSchema: { type: "object", properties: { spec: { type: "object" } }, required: ["spec"] },
        execute: function (inp) {
          var spec = inp.spec || {}; status("run_model: " + (spec.family || "?"));
          if (L.custom.length) spec.series = L.custom.map(function (c) { return { name: c.name, periods: c.periods, values: c.values, transform: c.transform, lagDays: c.lagDays }; });
          if (!spec.evaluation) spec.evaluation = { from: recordFirst(), horizons: ["H1", "H2", "H3"], lagMode: "standard", windows: labWindows() };
          L.family = spec.family || L.family; L.predictors = spec.predictors || []; L.options = spec.options || {}; L.form = spec.form || "auto";
          return runLab(spec).then(function (r) {
            if (!r.ok) return { ok: false, errors: r.errors };
            return { ok: true, model: r.model, nowcast: r.nowcast, accuracy_all: accRows(r, "all"), accuracy_evaluation_window: accRows(r, "main"), accuracy_test_period: accRows(r, "test"), coefficients: Object.keys(r.coefficients || {}).slice(0, 30).reduce(function (o, k) { o[k] = r.coefficients[k]; return o; }, {}), warnings: r.warnings, headline_for_comparison: { model: label(headlineId()), value: NC.headline.value } };
          });
        } }
    ];
    var lang = ["English", "Russian", "Uzbek (Latin script)", "Uzbek (Cyrillic script)"][H.L()];
    var prompt = "You are an econometrician at the Institute for Macroeconomic and Regional Studies (Tashkent) building GDP nowcasting models in the IMRS Data Hub model lab. Use ONLY the tools: they estimate models on official data with a pseudo-real-time design (release lags, expanding window, no look-ahead). " +
      "Plan the model the user asks for, call list_variables, add Hub series with search_hub/list_series/add_series when the request needs data not in the panel, then call run_model (you may run several variants and compare them with each other, with AR(2) and with the Hub's headline nowcast " + (NC.headline.value != null ? NC.headline.value.toFixed(2) : "(not available at this stage)") + "% for " + NC.target.quarter + " (" + label(headlineId()) + ")). " +
      "If a requested method is not one of the families, approximate it with the closest family or a combination and say so. Never invent numbers: quote only values returned by the tools. " +
      "Answer in " + lang + ", at most 180 words: what you built, the nowcast, how it compares on accuracy (RMSE relative to AR(2), all quarters and the test period), and caveats.\n\nRequest: " + q;
    L.ai.ctl = new AbortController();
    var go = document.getElementById("lab-ai-go"), stop = document.getElementById("lab-ai-stop");
    if (go) go.disabled = true; if (stop) stop.hidden = false; status(tr("thinking"));
    return SAMPLE(prompt, { tools: tools, signal: L.ai.ctl.signal, onText: function (u) { show(u.text); } }).then(function (r) { show(r.text); status(""); }, function (e) { if (e && e.text) show(e.text); status(e && e.code !== "cancelled" ? (e.message || e.code) : ""); });
  }).then(function () { var go = document.getElementById("lab-ai-go"), stop = document.getElementById("lab-ai-stop"); if (go) go.disabled = false; if (stop) stop.hidden = true; }, function (e) { status(e.message); });
}

/* ---------------- report builder ---------------- */
var TOPICS = [
  ["nowcast", ["GDP nowcast", "Наукаст ВВП", "YaIM naukasti"], true],
  ["models", ["Model comparison and accuracy", "Сравнение моделей и точность", "Modellarni taqqoslash va aniqlik"], true],
  ["evolution", ["Nowcast evolution and revisions", "Эволюция наукаста и пересмотры", "Naukast evolyutsiyasi va qayta ko'rib chiqishlar"], false],
  ["activity", ["Real activity indicators", "Индикаторы реальной активности", "Real faollik ko'rsatkichlari"], true],
  ["prices", ["Prices and monetary conditions", "Цены и денежно-кредитные условия", "Narxlar va pul-kredit sharoitlari"], true],
  ["external", ["External sector and exchange rate", "Внешний сектор и валютный курс", "Tashqi sektor va valyuta kursi"], true],
  ["money", ["Money, credit and payments", "Деньги, кредит и платежи", "Pul, kredit va to'lovlar"], false],
  ["fiscal", ["Budget execution", "Исполнение бюджета", "Byudjet ijrosi"], false],
  ["data", ["Data availability", "Доступность данных", "Ma'lumotlar mavjudligi"], false],
  ["crosscheck", ["Cross-source checks", "Сверка источников", "Manbalarni solishtirish"], false],
  ["method", ["Methodology", "Методология", "Metodologiya"], true]
];
function topicName(id, li) { var t = TOPICS.filter(function (x) { return x[0] === id; })[0]; if (!t) return id; var a = t[1]; return li === 3 ? uzc(a[2]) : a[li] || a[0]; }
function renderReports() {
  var el = body(), R = S.rep;
  if (!R.topics) R.topics = TOPICS.filter(function (t) { return t[2]; }).map(function (t) { return t[0]; });
  if (!R.lang) R.lang = H.state.lang;
  if (!R.title) R.title = tr("title") + " — " + NC.target.quarter;
  var h = '<p class="muted">' + esc(tr("rep_intro")) + '</p><div class="labgrid"><div class="labform panel">';
  h += '<label class="fld">' + esc(tr("rep_title")) + '<input id="rp-title" type="text" value="' + esc(R.title) + '"></label>';
  h += '<div class="optrow"><label>' + esc(tr("rep_lang")) + '<select id="rp-lang">' + [["en", "English"], ["ru", "Русский"], ["uz", "O'zbekcha"], ["uzc", "Ўзбекча"]].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === R.lang ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>";
  h += "<label>" + esc(tr("rep_length")) + '<select id="rp-len">' + ["brief", "standard", "full"].map(function (x) { return '<option value="' + x + '"' + (x === R.length ? " selected" : "") + ">" + esc(tr("len_" + x)) + "</option>"; }).join("") + "</select></label>";
  h += "<label>" + esc(tr("rep_audience")) + '<select id="rp-aud">' + ["policy", "technical"].map(function (x) { return '<option value="' + x + '"' + (x === R.audience ? " selected" : "") + ">" + esc(tr("aud_" + x)) + "</option>"; }).join("") + "</select></label></div>";
  h += '<div class="fld"><span>' + esc(tr("rep_topics")) + '</span><div class="topics">' + TOPICS.map(function (t) { return '<label><input type="checkbox" name="rpt" value="' + t[0] + '"' + (R.topics.indexOf(t[0]) >= 0 ? " checked" : "") + "> " + esc(topicName(t[0], H.L())) + "</label>"; }).join("") + "</div></div>";
  h += '<div class="fld"><span>' + esc(tr("rep_lab_runs")) + "</span>" + (S.runs.length ? S.runs.map(function (r, i) { return '<label><input type="checkbox" name="rpr" value="' + i + '"' + (r.include !== false ? " checked" : "") + "> " + esc(r.model) + " · " + esc(pct(r.nowcast.value, 2)) + "</label>"; }).join("") : '<span class="muted" style="font-size:12.5px">' + esc(tr("rep_no_runs")) + "</span>") + "</div>";
  h += '<div class="fld"><span>' + esc(tr("rep_chart_models")) + "</span>" + pickerHTML("rep", repAvail(), picked("rep", repAvail(), repDefault())) + "</div>";
  h += '<div class="optrow"><label>' + esc(tr("rep_charts")) + '<select id="rp-style"><option value="line"' + (R.style === "line" ? " selected" : "") + ">" + esc(tr("style_line")) + '</option><option value="bar"' + (R.style === "bar" ? " selected" : "") + ">" + esc(tr("style_bar")) + "</option></select></label><label>" + esc(tr("rep_text")) + '<select id="rp-ai"><option value="1"' + (R.ai ? " selected" : "") + ">" + esc(tr("text_ai")) + '</option><option value="0"' + (!R.ai ? " selected" : "") + ">" + esc(tr("text_tpl")) + '</option></select></label><label class="chk"><input type="checkbox" id="rp-tables"' + (R.tables ? " checked" : "") + "> " + esc(tr("rep_tables")) + "</label></div>";
  h += '<div class="ask-row"><button class="btn primary" id="rp-go"' + (R.busy ? " disabled" : "") + ">" + esc(tr("rep_go")) + '</button><button class="btn" id="rp-stop" hidden>' + esc(tr("stop")) + '</button><span class="ask-status" id="rp-status">' + esc(R.status || "") + "</span></div>";
  h += '</div><div class="labout"><div class="actions" id="rp-actions"' + (R.html ? "" : " hidden") + '><button class="btn" id="rp-dl">' + esc(tr("rep_dl_html")) + '</button><button class="btn" id="rp-md">' + esc(tr("rep_dl_md")) + '</button><button class="btn" id="rp-print">' + esc(tr("rep_print")) + '</button></div><iframe id="rp-frame" class="repframe" title="Report preview"' + (R.html ? "" : " hidden") + "></iframe></div></div>";
  el.innerHTML = h;
  if (!H.sample()) { var sa = document.getElementById("rp-ai"); sa.value = "0"; sa.disabled = true; R.ai = false;
    if (H.native) { var row = sa.closest(".optrow"); if (row) row.insertAdjacentHTML("afterend", '<p class="note info" style="margin:0">' + esc(tr("rep_ai_native")) + ' <a href="' + esc(H.claudeLink("nowcast/reports")) + '" target="_blank" rel="noopener">' + esc(tr("in_claude")) + "</a></p>"); } }
  function collect() {
    R.title = document.getElementById("rp-title").value; R.lang = document.getElementById("rp-lang").value; R.length = document.getElementById("rp-len").value; R.audience = document.getElementById("rp-aud").value;
    R.topics = Array.prototype.map.call(el.querySelectorAll('input[name="rpt"]:checked'), function (x) { return x.value; });
    Array.prototype.forEach.call(el.querySelectorAll('input[name="rpr"]'), function (x) { S.runs[+x.value].include = x.checked; });
    R.style = document.getElementById("rp-style").value; R.ai = document.getElementById("rp-ai").value === "1"; R.tables = document.getElementById("rp-tables").checked;
  }
  Array.prototype.forEach.call(el.querySelectorAll("input,select"), function (x) { x.addEventListener("change", collect); });
  document.getElementById("rp-go").onclick = function () { collect(); buildReport(); };
  document.getElementById("rp-stop").onclick = function () { if (R.ctl) R.ctl.abort(); };
  bindPicker(el, "rep", repAvail(), repDefault(), function () {});
  if (R.html) showReport();
}
function repAvail() { var P = predIndex(); return chartModels().filter(function (m) { return P[m]; }); }
function repDefault() { return [headlineId()].concat(Object.keys(NC.headline.components || {}), ["ar2"]); }
function repStatus(m) { S.rep.status = m; var s = document.getElementById("rp-status"); if (s) s.textContent = m; }
function hubSeries(id, key) {
  var d = H.byId(id); if (!d) return Promise.resolve(null);
  return H.loadShard(d.sh).then(function (sh) { var x = sh[id], r = null; if (!x || !x.r) return null; x.r.forEach(function (rr) { if (String(rr.k) === String(key)) r = rr; }); r = r || x.r[0]; return { id: id, name: pick0(d.n), label: r.l[0] || r.l[1] || r.k, periods: x.p, values: r.v, unit: H.pick(x.m.unit) || d.u }; }, function () { return null; });
}
function lastN(periods, values, n) { var P = [], V = []; for (var i = 0; i < periods.length; i++) if (values[i] != null) { P.push(periods[i]); V.push(values[i]); } return { p: P.slice(-n), v: V.slice(-n) }; }
function panelField(f, n) {
  var d = PANEL.monthly.dates, v = PANEL.monthly.values[f] || [];
  var r = lastN(d.map(function (x) { return x.slice(0, 7); }), v, n || 24);
  return { p: r.p, v: r.v, name: (varByField(f) || {}).name || f };
}
function buildReport() {
  var R = S.rep, li = ["en", "ru", "uz", "uzc"].indexOf(R.lang), fixed = true;
  R.busy = true; repStatus(tr("rep_building"));
  var go = document.getElementById("rp-go"); if (go) go.disabled = true;
  var n = R.length === "brief" ? 12 : R.length === "full" ? 36 : 24;
  var want = function (t) { return R.topics.indexOf(t) >= 0; };
  var jobs = [];
  if (want("prices")) jobs.push(hubSeries("siat-4689", "1"), hubSeries("cbu-policy-rate", "P1")); else jobs.push(null, null);
  if (want("fiscal")) jobs.push(hubSeries("ob-state-budget-revenue", "state-budget-revenues"), hubSeries("ob-state-budget-expenditure", "expenditures")); else jobs.push(null, null);
  if (want("crosscheck")) jobs.push(H.getJSON("data/crosscheck.gz.txt").then(function (x) { CCX = x; return x; }, function () { return null; })); else jobs.push(null);
  Promise.all(jobs).then(function (res) {
    var cpi = res[0], pol = res[1], rev = res[2], exp = res[3], cc = res[4];
    var hd = NC.headline, mem = Object.keys(hd.components || {}), al = (NC.alerts || []).filter(function (x) { return x.kind === "fx_month_partial"; })[0];
    var sections = [], facts = { target_quarter: NC.target.quarter, stage: NC.target.stage, as_of: NC.as_of,
      headline: { value: round(hd.value), method: label(hd.model), formula: hd.formula, members: mem.map(function (m) { return [label(m), round(hd.components[m]), hd.weights && hd.weights[m]]; }), range: hd.indicative_range && [round(hd.indicative_range.low), round(hd.indicative_range.high)],
        gdp_basis: "The headline's two models train on GDP growth as SIAT first published it at each date (real-time vintages); the other models train on today's revised figures.",
        fallback: hd.fallback ? { method: label(hd.fallback.model), value: round(hd.fallback.value) } : null },
      previous_headlines: (hd.previous || []).map(function (m) { return { method: label(m), value: round(currentValue(m)) }; }),
      benchmark_ar2: round(currentValue("ar2")), latest_gdp: NC.target.latest_gdp,
      alignment_warning: al ? { previous_stage: al.previous_stage, previous_stage_value: round(al.previous_stage_headline != null ? al.previous_stage_headline : al.previous_stage_ensemble) } : null };
    function chart(series, labels, opts) { opts = opts || {}; return lineChart({ labels: labels, series: series, fixed: fixed, width: 760, height: opts.height || 280, bars: opts.bars != null ? opts.bars : R.style === "bar", band: opts.band, ref: opts.ref }) + legendHTML(series, fixed); }
    function table(head, rows) { return R.tables ? '<table class="t"><thead><tr>' + head.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (x) { return "<td>" + esc(x) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>" : ""; }
    if (want("nowcast")) {
      var qs = PANEL.quarterly.quarters, gdp = PANEL.quarterly.gdp_real_yoy_pct, from = Math.max(0, qs.length - (R.length === "brief" ? 8 : 16)), shown = picked("rep", repAvail(), repDefault());
      var labs = qs.slice(from).concat([NC.target.quarter]);
      var s1 = { name: ["Official GDP growth", "Официальный рост ВВП", "Rasmiy YaIM o'sishi", "Расмий ЯИМ ўсиши"][li], color: 0, width: 3, values: labs.map(function (q) { var i = qs.indexOf(q); return i >= 0 ? gdp[i] : null; }) };
      var ser = [s1].concat(shown.map(function (m, i) { var pr = predRows(m, "H3", "standard"); return { name: label(m), color: colorFor(m, i), width: isHeadline(m) ? 2.5 : 2, values: labs.map(function (q) { return pr[q] != null ? pr[q] : q === NC.target.quarter ? currentValue(m) : null; }) }; }));
      sections.push({ id: "nowcast", charts: [chart(ser, labs, { bars: false })], tables: [table(["", "%"], [[label(hd.model), nf(hd.value)]].concat(mem.map(function (m) { return [label(m), nf(hd.components[m])]; }), [[label("ar2"), nf(currentValue("ar2"))]]))] });
      facts.gdp_history = labs.map(function (q, i) { return [q, s1.values[i]].concat(ser.slice(1).map(function (x) { return x.values[i] == null ? null : round(x.values[i]); })); });
      facts.gdp_history_columns = ["quarter", "official"].concat(ser.slice(1).map(function (x) { return x.name; }));
    }
    if (want("models")) {
      var items = (NC.models || []).filter(function (r) { return r.value != null; }).map(function (r) { var d = r.details || {}; return { label: r.label, value: r.value, strong: isHeadline(r.model), band68: d.band68, band90: d.band90 }; });
      S.runs.forEach(function (r) { if (r.include !== false && r.nowcast && r.nowcast.value != null) items.push({ label: "Lab: " + r.model, value: r.nowcast.value }); });
      var acc = NC.accuracy.rows.filter(function (r) { return r[4] === "all" && r[5] === "standard" && r[6] === "pooled" && r[3] !== "single" && r[7] > 0; }).sort(function (a, b) { return a[8] - b[8]; }).slice(0, R.length === "brief" ? 6 : 14);
      sections.push({ id: "models", charts: [dotPlot(items, { value: hd.value }, true, 760)], tables: [table(["Model", "RMSE", "÷AR(2)", NC.target.quarter], acc.map(function (r) { return [r[1], nf(r[8], 3), nf(r[11], 2), nf(currentValue(r[0]))]; }))] });
      facts.models = items.map(function (it) { return [it.label, round(it.value)]; });
      facts.accuracy_all_quarters_pooled = acc.map(function (r) { return [r[1], round(r[8]), round(r[11]), r[7]]; });
      var GV = NC.gdp_vintages || {};
      if (GV.available) facts.headline_quarters_rmse_vs_first_release_and_latest = (GV.accuracy || []).filter(function (a) { return a.horizon === "pooled"; }).map(function (a) { return [label(a.model), round(a.rmse_first), round(a.rmse_latest), a.N, a.first + "-" + a.last]; });
      facts.lab_runs = S.runs.filter(function (r) { return r.include !== false; }).map(function (r) { return { model: r.model, family: r.family, predictors: r.spec && r.spec.predictors, nowcast: r.nowcast && round(r.nowcast.value), pooled: (r.accuracy.all || []).filter(function (m) { return m.horizon === "pooled"; }).map(function (m) { return { rmse: round(m.rmse), rel_ar2: round(m.rmse_rel_ar2) }; }) }; });
    }
    if (want("evolution")) {
      var rec = NC.evolution.reconstructed || [], hz = ["H1", "H2", "H3"].filter(function (x) { return x <= NC.target.stage; });
      var ms = [hd.model].concat(mem, ["ar2", "dfm_kalman"]);
      var ser2 = ms.map(function (m, i) { return { name: label(m), color: colorFor(m, i), values: hz.map(function (x) { var v = null; rec.forEach(function (r) { if (r.model === m && r.horizon === x) v = r.value; }); return v; }) }; }).filter(function (x) { return x.values.some(function (v) { return v != null; }); });
      sections.push({ id: "evolution", charts: [chart(ser2, hz, { bars: false })] });
      facts.evolution = ser2.map(function (x) { return [x.name, x.values.map(round)]; });
    }
    if (want("activity")) {
      var fs = ["ind_prod_yoy_log", "construction_yoy_log", "retail_trade_yoy_log", "wholesale_trade_yoy_log"].filter(function (f) { return PANEL.monthly.values[f]; });
      var pf = fs.map(function (f) { return panelField(f, n); }), lab2 = pf.length ? pf[0].p : [];
      var sers = pf.map(function (x, i) { return { name: x.name + ", % y/y", color: i, values: lab2.map(function (p) { var k = x.p.indexOf(p); return k >= 0 ? x.v[k] : null; }) }; });
      sections.push({ id: "activity", charts: [chart(sers, lab2)] });
      facts.activity = pf.map(function (x) { return { name: x.name, last: x.p[x.p.length - 1], values_last_6: x.v.slice(-6).map(round) }; });
    }
    if (want("prices")) {
      var ch = [], fp = {};
      if (cpi) { var c = lastN(cpi.periods, cpi.values, n), off = c.v.length && c.v[c.v.length - 1] > 50 ? 100 : 0; ch.push(chart([{ name: "CPI, % y/y (SIAT)", color: 7, values: c.v.map(function (v) { return v - off; }) }], c.p, { bars: false })); fp.cpi_yoy = c.p.slice(-6).map(function (p, i) { return [p, round(c.v.slice(-6)[i] - off)]; }); }
      if (pol) { var pr = lastN(pol.periods, pol.values, 12); fp.policy_rate = pr.p.map(function (p, i) { return [p, pr.v[i]]; }); }
      var fx = panelField("usd_uzs_mom_dlog", n);
      ch.push(chart([{ name: "USD/UZS, monthly log change ×100", color: 0, values: fx.v }], fx.p));
      fp.usd_uzs_mom = fx.v.slice(-6).map(round);
      sections.push({ id: "prices", charts: ch }); facts.prices = fp;
    }
    if (want("external")) {
      var ef = ["exports_total_yoy_log", "exports_non_gold_yoy_log", "imports_total_yoy_log"].filter(function (f) { return PANEL.monthly.values[f]; }).map(function (f) { return panelField(f, n); });
      var el2 = ef.length ? ef[0].p : [];
      sections.push({ id: "external", charts: [chart(ef.map(function (x, i) { return { name: x.name + ", % y/y", color: i, values: el2.map(function (p) { var k = x.p.indexOf(p); return k >= 0 ? x.v[k] : null; }) }; }), el2)] });
      facts.external = ef.map(function (x) { return { name: x.name, last: x.p[x.p.length - 1], values_last_6: x.v.slice(-6).map(round) }; });
    }
    if (want("money")) {
      var mf = ["m2_yoy_log", "fx_reserves_exgold_yoy_log", "household_credit_yoy_log", "corporate_credit_yoy_log"].filter(function (f) { return PANEL.monthly.values[f]; }).map(function (f) { return panelField(f, n); });
      var ml = mf.length ? mf[0].p : [];
      sections.push({ id: "money", charts: [chart(mf.map(function (x, i) { return { name: x.name + ", % y/y", color: i, values: ml.map(function (p) { var k = x.p.indexOf(p); return k >= 0 ? x.v[k] : null; }) }; }), ml, { bars: false })] });
      facts.money = mf.map(function (x) { return { name: x.name, last: x.p[x.p.length - 1], values_last_6: x.v.slice(-6).map(round) }; });
    }
    if (want("fiscal") && rev && exp) {
      var rq = lastN(rev.periods.filter(function (p) { return /Q/.test(p); }), rev.values.filter(function (v, i) { return /Q/.test(rev.periods[i]); }), R.length === "brief" ? 8 : 12);
      var eq = rq.p.map(function (p) { var k = exp.periods.indexOf(p); return k >= 0 ? exp.values[k] : null; });
      sections.push({ id: "fiscal", charts: [chart([{ name: "State budget revenue, bn UZS", color: 2, values: rq.v }, { name: "State budget expenditure, bn UZS", color: 7, values: eq }], rq.p, { bars: true })] });
      facts.fiscal = rq.p.map(function (p, i) { return [p, round(rq.v[i]), round(eq[i])]; });
    }
    if (want("data")) {
      var rows = NC.data_availability.rows;
      sections.push({ id: "data", tables: [table(["Indicator", "Latest usable", "Status"], rows.map(function (r) { return [r.name, r.latest_usable ? r.latest_usable.slice(0, 7) : "–", r.status]; }))] });
      facts.data_availability = NC.data_availability.summary;
    }
    if (want("crosscheck") && cc) {
      var inds = (cc.indicators || []).slice(0, R.length === "brief" ? 6 : 20);
      sections.push({ id: "crosscheck", tables: [table(["Indicator", "Period", "Status"], inds.map(function (ind) { return [ind.n[li] || ind.n[0], (ind.gap && ind.gap.period) || "–", (ind.gap && ind.gap.status) || "–"]; }))] });
      facts.crosscheck = inds.map(function (ind) { return [ind.n[0], ind.gap && ind.gap.status, ind.gap && ind.gap.max]; });
    }
    if (want("method")) { sections.push({ id: "method" }); facts.method = { headline: label(hd.model), headline_formula: hd.formula, headline_selection: hd.selection, release_rule: PANEL.release_rule, evaluation_quarters: winSpan("all").join("–"), test_period: winSpan("test").join("–"), models_evaluated: (NC.models || []).length + (NC.single_indicator || []).length }; }
    R.sections = sections; R.facts = facts;
    if (R.ai && H.sample()) return writeWithClaude(sections, facts, li);
    return templateText(sections, facts, li);
  }).then(function (texts) {
    R.texts = texts; R.html = assembleReport(R, li); R.busy = false; repStatus(tr("rep_done"));
    var go2 = document.getElementById("rp-go"); if (go2) go2.disabled = false;
    showReport();
  }, function (e) {
    R.busy = false; repStatus(e && e.message ? e.message : String(e)); var go2 = document.getElementById("rp-go"); if (go2) go2.disabled = false;
  });
}
function round(v) { return v == null || isNaN(v) ? null : Math.round(v * 100) / 100; }
function writeWithClaude(sections, facts, li) {
  var R = S.rep, SAMPLE = H.sample();
  var lang = ["English", "Russian", "Uzbek (Latin script)", "Uzbek (Cyrillic script)"][li];
  var words = R.length === "brief" ? "40–70" : R.length === "full" ? "180–260" : "90–140";
  var ids = sections.map(function (s) { return s.id; });
  var prompt = "Write the text of a macroeconomic report for the Institute for Macroeconomic and Regional Studies (Tashkent), audience: " + (R.audience === "technical" ? "economists (technical report: name the models and statistics precisely)" : "senior management (policy brief: plain language, lead with the message)") + ". Language: " + lang + ". Title: " + R.title + ".\n" +
    "Use ONLY the facts below (official statistics and model results computed by the IMRS Data Hub). Do not invent numbers, dates or events; if a fact is missing, do not speculate. Growth figures are percent year on year; GDP growth is year to date (Q1 = January–March, Q2 = January–June, Q3 = January–September, Q4 = the whole year, each compared with the same months a year earlier); model values are nowcasts, not official statistics. The fact named headline is the IMRS Data Hub's headline nowcast: the most accurate method of its pseudo-real-time evaluation (headline.method, built from headline.members); report it as the nowcast and mention other models only as alternatives. If alignment_warning is present, mention that the ensemble member may move when the month's exchange-rate data complete.\n" +
    "Return JSON only: {\"summary\": [3 to 5 short bullet sentences], \"sections\": {" + ids.map(function (id) { return "\"" + id + "\": \"" + words + " words\""; }).join(", ") + "}} with one paragraph (or two for full length) per section id, plain text, no markdown.\n\nFacts:\n" + JSON.stringify(facts);
  repStatus(tr("rep_writing"));
  R.ctl = new AbortController(); var stop = document.getElementById("rp-stop"); if (stop) stop.hidden = false;
  return SAMPLE.json(prompt, { signal: R.ctl.signal, modelTier: R.length === "brief" ? "quick" : "default" }).then(function (j) {
    if (stop) stop.hidden = true;
    return { summary: (j && j.summary) || [], sections: (j && j.sections) || {} };
  }, function (e) { if (stop) stop.hidden = true; if (e && e.code === "cancelled") throw new Error("Cancelled"); return templateText(sections, facts, li); });
}
/** "2026Q3" -> "January–September 2026" in the page language (0 en, 1 ru, 2 uz, 3 uzc). */
function ytdSpan(q, li) {
  var m = /^(\d{4})Q([1-4])$/.exec(String(q || "")); if (!m) return String(q || "");
  var k = +m[2] - 1, y = m[1];
  var en = ["January–March", "January–June", "January–September", "January–December"], ru = ["январь–март", "январь–июнь", "январь–сентябрь", "январь–декабрь"], uz = ["yanvar–mart", "yanvar–iyun", "yanvar–sentabr", "yanvar–dekabr"];
  var w = [en, ru, uz, uz][li == null ? 0 : li][k];
  var out = li === 2 || li === 3 ? y + "-yil " + w : w + " " + y;
  return li === 3 ? uzc(out) : out;
}
function templateText(sections, facts, li) {
  var f = facts, T = {}, hv = f.headline || {};
  var L4 = function (en, ru, uz) { return [en, ru, uz, uzc(uz)][li]; };
  var sum = [L4("Real GDP growth for " + ytdSpan(f.target_quarter, 0) + " (year to date, " + f.target_quarter + ") is nowcast at " + nf(hv.value) + "% compared with the same months a year earlier (stage " + f.stage + ", data to " + f.as_of + ").", "Рост реального ВВП за " + ytdSpan(f.target_quarter, 1) + " (с начала года, " + f.target_quarter + ") оценивается в " + nf(hv.value) + "% к тем же месяцам прошлого года (этап " + f.stage + ", данные на " + f.as_of + ").", f.target_quarter + " (yil boshidan, " + ytdSpan(f.target_quarter, 2) + ") uchun real YaIM o'sishi o'tgan yilning shu oylariga nisbatan " + nf(hv.value) + "% deb baholanmoqda (" + f.stage + " bosqichi, " + f.as_of + " holatiga).")];
  if (hv.method) sum.push(L4("Method: " + hv.method + ", the most accurate in the Hub's pseudo-real-time evaluation.", "Метод: " + hv.method + " — самый точный в псевдореальной оценке хаба.", "Usul: " + hv.method + " — Hubning psevdo-real vaqt baholashida eng aniq."));
  if (f.latest_gdp) sum.push(L4("The latest official figure is " + nf(f.latest_gdp.value) + "% for " + f.latest_gdp.quarter + ".", "Последнее официальное значение — " + nf(f.latest_gdp.value) + "% за " + f.latest_gdp.quarter + ".", "So'nggi rasmiy qiymat — " + f.latest_gdp.quarter + " uchun " + nf(f.latest_gdp.value) + "%."));
  if (hv.range) sum.push(L4("Past forecast errors suggest a range of " + nf(hv.range[0]) + "–" + nf(hv.range[1]) + "%.", "Прошлые ошибки прогноза дают диапазон " + nf(hv.range[0]) + "–" + nf(hv.range[1]) + "%.", "O'tgan prognoz xatolari " + nf(hv.range[0]) + "–" + nf(hv.range[1]) + "% oralig'ini ko'rsatadi."));
  if (f.alignment_warning) sum.push(L4("The current exchange-rate month is incomplete; at stage " + f.alignment_warning.previous_stage + " the ensemble was " + nf(f.alignment_warning.previous_stage_value) + "%.", "Текущий месяц курса ещё не завершён; на этапе " + f.alignment_warning.previous_stage + " ансамбль давал " + nf(f.alignment_warning.previous_stage_value) + "%.", "Joriy oy kurs ma'lumotlari hali to'liq emas; " + f.alignment_warning.previous_stage + " bosqichida ansambl " + nf(f.alignment_warning.previous_stage_value) + "% edi."));
  sections.forEach(function (s) {
    var t = "", mem = (hv.members || []).map(function (m) { return m[0] + " (" + nf(m[1]) + "%)"; }).join(", ");
    if (s.id === "nowcast") t = L4("The headline combines " + mem + ".", "Основной наукаст объединяет: " + mem + ".", "Asosiy naukast quyidagilarni birlashtiradi: " + mem + ".");
    else if (s.id === "models" && f.models) { var vs = f.models.map(function (m) { return m[1]; }).filter(function (v) { return v != null; }); t = L4("The other models range from " + nf(Math.min.apply(null, vs)) + "% to " + nf(Math.max.apply(null, vs)) + "%; accuracy over all evaluated quarters is shown relative to AR(2).", "Остальные модели дают от " + nf(Math.min.apply(null, vs)) + "% до " + nf(Math.max.apply(null, vs)) + "%; точность по всем кварталам оценки показана относительно AR(2).", "Boshqa modellar " + nf(Math.min.apply(null, vs)) + "% dan " + nf(Math.max.apply(null, vs)) + "% gacha; barcha baholangan choraklar bo'yicha aniqlik AR(2) ga nisbatan ko'rsatilgan."); }
    else if (s.id === "method") t = L4("Pseudo-real-time evaluation with an expanding window; indicators are used only once released under the registry release lags. The headline is the method with the lowest pseudo-real-time error.", "Оценка в псевдореальном времени на расширяющемся окне; индикаторы используются только после публикации с учётом лагов. Основной наукаст — метод с наименьшей ошибкой в псевдореальном времени.", "Kengayib boruvchi oynada psevdo-real vaqt baholash; ko'rsatkichlar faqat e'lon qilingandan keyin ishlatiladi. Asosiy naukast — psevdo-real vaqtdagi xatosi eng kichik usul.");
    else t = L4("See the chart and table below.", "См. график и таблицу ниже.", "Quyidagi grafik va jadvalga qarang.");
    T[s.id] = t;
  });
  return Promise.resolve({ summary: sum, sections: T });
}
function assembleReport(R, li) {
  var css = "body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#132129;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.55;font-size:14.5px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;color:#0b6e78}.sub{color:#5f707a;font-size:13px;margin-bottom:18px}.sum{background:#e9eff0;border-radius:10px;padding:12px 18px}.sum li{margin:4px 0}svg{width:100%;height:auto;margin:6px 0}.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:#3b4b54}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:14px;height:3px;display:inline-block;border-radius:2px}table.t{border-collapse:collapse;font-size:12.5px;margin:10px 0;width:100%}table.t th,table.t td{border-bottom:1px solid #d4dfe1;padding:4px 8px;text-align:left}table.t th{background:#e9eff0}.foot{margin-top:30px;font-size:11.5px;color:#5f707a;border-top:1px solid #d4dfe1;padding-top:8px}@media print{body{margin:0}h2{break-after:avoid}svg,table{break-inside:avoid}}";
  var date = fmtDate(NC.as_of);
  var h = '<!doctype html><html lang="' + ["en", "ru", "uz", "uz"][li] + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(R.title) + '</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap"><style>' + css + "</style></head><body>";
  h += "<h1>" + esc(R.title) + '</h1><div class="sub">' + esc(["Institute for Macroeconomic and Regional Studies · IMRS Data Hub", "Институт макроэкономических и региональных исследований · IMRS Data Hub", "Makroiqtisodiy va hududiy tadqiqotlar instituti · IMRS Data Hub", "Макроиқтисодий ва ҳудудий тадқиқотлар институти · IMRS Data Hub"][li]) + " · " + esc(date) + "</div>";
  var tx = R.texts || { summary: [], sections: {} };
  if (tx.summary && tx.summary.length) h += '<div class="sum"><ul>' + tx.summary.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div>";
  (R.sections || []).forEach(function (s) {
    h += "<h2>" + esc(topicName(s.id, li)) + "</h2>";
    var p = tx.sections && tx.sections[s.id]; if (p) String(p).split(/\n\n+/).forEach(function (para) { h += "<p>" + esc(para) + "</p>"; });
    (s.charts || []).forEach(function (c) { h += c; });
    (s.tables || []).forEach(function (t) { h += t; });
  });
  h += '<div class="foot">' + esc(["Sources: Statistics Agency (SIAT), Central Bank of Uzbekistan, Ministry of Economy and Finance and other publishers collected by the IMRS Data Hub. Nowcasts are model estimates, not official statistics.", "Источники: Агентство статистики (SIAT), Центральный банк, Минэкономфин и другие издатели в IMRS Data Hub. Наукасты — модельные оценки, а не официальная статистика.", "Manbalar: Statistika agentligi (SIAT), Markaziy bank, Iqtisodiyot va moliya vazirligi va IMRS Data Hub to'plagan boshqa nashriyotchilar. Naukastlar rasmiy statistika emas, model baholari.", "Манбалар: Статистика агентлиги (SIAT), Марказий банк, Иқтисодиёт ва молия вазирлиги ва IMRS Data Hub тўплаган бошқа нашриётчилар. Наукастлар расмий статистика эмас, модел баҳолари."][li]) + "</div></body></html>";
  return h;
}
function showReport() {
  var R = S.rep, fr = document.getElementById("rp-frame"), acts = document.getElementById("rp-actions");
  if (!fr) return;
  fr.hidden = false; acts.hidden = false; fr.srcdoc = R.html;
  document.getElementById("rp-dl").onclick = function () { H.save(slug(R.title) + ".html", R.html, "text/html"); };
  document.getElementById("rp-md").onclick = function () { H.save(slug(R.title) + ".md", toMarkdown(R), "text/markdown"); };
  document.getElementById("rp-print").onclick = function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { H.toast("Print is not available here; download the HTML and print it."); } };
}
function slug(s) { return String(s || "report").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "report"; }
function toMarkdown(R) {
  var li = ["en", "ru", "uz", "uzc"].indexOf(R.lang), tx = R.texts || { summary: [], sections: {} };
  var md = "# " + R.title + "\n\n" + fmtDate(NC.as_of) + "\n\n" + (tx.summary || []).map(function (s) { return "- " + s; }).join("\n") + "\n";
  (R.sections || []).forEach(function (s) { md += "\n## " + topicName(s.id, li) + "\n\n" + ((tx.sections || {})[s.id] || "") + "\n"; });
  return md;
}

/* ---------------- data & sources ---------------- */
var ANALYSIS = {
  en: [
    ["Coverage", "{a} of the registry's {r} monthly predictors and the GDP target are in the Hub: the official series from its own copies of the official tables (Statistics Agency SIAT, the Central Bank and the NSDP files), the world gold price from the World Bank's monthly commodity prices (Pink Sheet), and three satellite series supplied by IMRS, so the nowcast and the rest of the portal use the same numbers. Russia's industrial production (Rosstat) is not collected. GDP growth before 2018 (2016–2017) comes from SIAT table 3122, the same total by the expenditure method. The headline's models also use GDP growth as SIAT first published it: IMRS's documented record of stat.uz releases from 2018Q3, then every figure the Hub reads."],
    ["Satellite data", "Three monthly satellite series supplied by IMRS were added on 5 October 2026 as experimental variables: night-time light radiance (VIIRS), the vegetation index NDVI (MODIS) and tropospheric NO2 (Sentinel-5P), each a mean over Uzbekistan. Night lights enter one experimental model, the Tiers A–C factor model with night lights, which is re-tested every quarter in the model lab; NDVI and NO2 can be used in the lab. They are updated when IMRS supplies a newer extract."],
    ["Long history", "The NSDP (IMF format) files extend exports, imports and gold exports back to 2016 and industrial production further back; the full daily exchange-rate history since 1994 is in one table; banking and payment series come from the Central Bank's statistical bulletin and its latest monthly snapshots."],
    ["Efficient updates", "Every two weeks the Hub fetches only what changed since the last run (one request per day of exchange rates for all currencies, a new Excel edition only when the Central Bank publishes one), and every model reuses the same copy. Where the Central Bank's open-data JSON is truncated (M2, payments), the Hub takes the same series from the complete NSDP SDMX files and the Central Bank's statistics workbooks."],
    ["New indicators", "37 further Hub indicators are listed below as candidates: services, transport, agriculture, electricity, investment and wages from SIAT; loans by sector and new lending, bank rates, UZONIA and the policy rate from the Central Bank; stock-exchange indices and currency-exchange volumes; monthly central-government finance and regional budget execution; public procurement; commodity-exchange quotes; IMF industrial production and trade-by-partner data."],
    ["Credits", "Model estimation, back-testing and charts run in the browser or in the fortnightly update, so they use no AI credits. Claude is used only when you ask it to design a model or write report text, and it receives compact summaries rather than raw data."],
    ["data.egov.uz", "The national open-data portal is in the Hub as well (about 9,400 datasets of 179 bodies, loaded from a copy made in Uzbekistan because the site blocks foreign connections). For nowcasting the useful additions are few: banks' monthly counts of loans, cards and money transfers, the Pension Fund's monthly recipients and renewable electricity output; the Central Bank's monetary surveys there duplicate what the Hub already takes from the Central Bank. Most other datasets are registers or annual regional tables."]
  ],
  ru: [
    ["Охват", "{a} из {r} месячных предикторов реестра и целевой ВВП есть в хабе: официальные ряды — из копий официальных таблиц в хабе (SIAT Агентства статистики, ЦБ и файлы NSDP), мировая цена золота — из месячных цен на сырьё Всемирного банка (Pink Sheet), три спутниковых ряда предоставлены IMRS; поэтому наукаст и остальные разделы портала используют одни и те же цифры. Промышленное производство России (Росстат) не собирается. Рост ВВП до 2018 года (2016–2017) берётся из таблицы SIAT 3122 — тот же показатель по методу расходов. Модели основного наукаста используют также первоначально опубликованные данные ВВП: задокументированные ИМИР публикации stat.uz с 2018Q3, затем все значения, которые считывает хаб."],
    ["Спутниковые данные", "5 октября 2026 года как экспериментальные переменные добавлены три месячных спутниковых ряда, предоставленных IMRS: яркость ночных огней (VIIRS), вегетационный индекс NDVI (MODIS) и тропосферный NO2 (Sentinel-5P), каждый — среднее по Узбекистану. Ночные огни входят в одну экспериментальную модель — факторную модель уровней A–C с ночными огнями, которая перепроверяется каждый квартал в лаборатории моделей; NDVI и NO2 можно использовать в лаборатории. Ряды обновляются, когда IMRS предоставляет новую выгрузку."],
    ["Длинная история", "Файлы NSDP (формат МВФ) продлевают экспорт, импорт и экспорт золота до 2016 года, а промышленное производство — ещё дальше; полная дневная история курсов с 1994 года хранится в одной таблице; банковские и платёжные ряды берутся из статистического бюллетеня ЦБ и его последних месячных выпусков."],
    ["Экономичное обновление", "Раз в две недели хаб загружает только изменения (один запрос курсов в день для всех валют, новая редакция Excel — только когда ЦБ её публикует), и все модели используют одну копию. Где JSON открытых данных ЦБ обрезан (M2, платежи), хаб берёт те же ряды из полных файлов NSDP SDMX и таблиц статистики ЦБ."],
    ["Новые индикаторы", "Ниже перечислены ещё 37 индикаторов хаба: услуги, транспорт, сельское хозяйство, электроэнергия, инвестиции и зарплаты (SIAT); кредиты по отраслям, ставки, UZONIA и основная ставка (ЦБ); биржевые индексы и объёмы валютных торгов; ежемесячное исполнение бюджета; госзакупки; котировки товарной биржи; данные МВФ."],
    ["Кредиты", "Оценка моделей, тестирование и графики выполняются в браузере или при плановом обновлении и не расходуют кредиты ИИ. Claude используется только когда вы просите спроектировать модель или написать текст отчёта."],
    ["data.egov.uz", "Национальный портал открытых данных тоже в хабе (около 9 400 наборов 179 органов; загружен из копии, сделанной в Узбекистане, так как сайт закрыт для зарубежных подключений). Для наукастинга полезных добавлений немного: ежемесячные данные банков о выданных кредитах, картах и денежных переводах, ежемесячное число получателей пенсий и выработка электроэнергии на возобновляемых источниках; денежные обзоры ЦБ там повторяют то, что хаб уже берёт у самого ЦБ. Большинство остальных наборов — реестры или годовые региональные таблицы."]
  ]
};
function renderData() {
  var el = body(), A = NC.data_availability, li = H.L();
  var h = "<div><h3 class=\"section-title\">" + esc(tr("analysis")) + '</h3><div class="analysis">' + (ANALYSIS[li === 1 ? "ru" : "en"]).map(function (x) { return "<div><b>" + esc(x[0]) + "</b><p>" + esc(x[1].split("{a}").join(A.summary.available).split("{r}").join(A.summary.registered)) + "</p></div>"; }).join("") + "</div></div>";
  h += "<div><h3 class=\"section-title\">" + esc(tr("avail", { d: fmtDate(A.origin) })) + '</h3><p class="muted" style="font-size:13px">' + A.summary.available + " / " + A.summary.registered + " · " + esc(tr("indicators_usable")) + '</p><div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("indicator")) + "</th><th>" + esc(tr("latest_usable")) + "</th><th>" + esc(tr("in_hub")) + "</th><th>" + esc(tr("lag_days")) + "</th><th>" + esc(tr("status")) + "</th><th>" + esc(tr("hub_dataset")) + "</th></tr></thead><tbody>";
  A.rows.forEach(function (r) { var cls = r.status === "Available" ? "ok" : r.status === "Missing" ? "bad" : "warn"; h += "<tr><td>" + esc(r.name) + '<div class="muted mono" style="font-size:11px">' + esc(r.field || r.key) + "</div></td><td>" + esc(r.latest_usable ? r.latest_usable.slice(0, 7) : "–") + "</td><td>" + esc(r.latest_in_hub ? r.latest_in_hub.slice(0, 7) : "–") + "</td><td>" + (r.lag_days == null ? "–" : r.lag_days) + '</td><td><span class="badge ' + cls + '">' + esc(r.status) + "</span></td><td>" + (r.hub_source ? '<button class="linkbtn mono" data-ds="' + esc(r.hub_source) + '">' + esc(r.hub_source) + "</button>" : "–") + "</td></tr>"; });
  h += "</tbody></table></div></div>";
  h += '<div><h3 class="section-title">' + esc(tr("registry", { n: (PANEL.variables || []).length })) + '</h3><div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("indicator")) + "</th><th>" + esc(tr("transform")) + "</th><th>" + esc(tr("lag_days")) + "</th><th>" + esc(tr("hub_dataset")) + "</th><th>Source</th></tr></thead><tbody>";
  (PANEL.variables || []).forEach(function (v) { h += "<tr><td>" + esc(v.name) + '<div class="muted" style="font-size:11.5px">' + esc(v.block) + " · " + esc(v.role || "") + "</div></td><td>" + esc(v.transform) + "</td><td>" + (v.lag_days == null ? "–" : v.lag_days) + "</td><td>" + (v.hub_sources || []).map(function (s) { return '<button class="linkbtn mono" data-ds="' + esc(s.dataset) + '">' + esc(s.dataset) + "</button> " + '<span class="muted mono" style="font-size:11px">' + esc(s.key || "") + "</span>"; }).join("<br>") + '</td><td style="white-space:normal;min-width:200px;font-size:12px">' + esc(v.native_source || "") + (v.hub_notes ? '<div class="muted">' + esc(v.hub_notes) + "</div>" : "") + "</td></tr>"; });
  h += "</tbody></table></div></div>";
  h += '<div><h3 class="section-title">' + esc(tr("candidates")) + '</h3><div class="tablewrap"><table class="data"><thead><tr><th>' + esc(tr("indicator")) + "</th><th>Group</th><th>" + esc(tr("hub_dataset")) + "</th><th>Coverage</th><th>Notes</th></tr></thead><tbody>";
  (PANEL.candidates || []).forEach(function (c) { h += "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.group) + '</td><td><button class="linkbtn mono" data-ds="' + esc(c.dataset) + '">' + esc(c.dataset) + '</button><div class="muted mono" style="font-size:11px">' + esc(c.keys || "") + "</div></td><td>" + esc(c.coverage || "") + '</td><td style="white-space:normal;min-width:220px;font-size:12px">' + esc(c.notes || "") + "</td></tr>"; });
  h += "</tbody></table></div></div>";
  el.innerHTML = h;
  Array.prototype.forEach.call(el.querySelectorAll("[data-ds]"), function (b) { b.onclick = function () { var id = b.getAttribute("data-ds"); if (H.byId(id)) H.openDataset(id); }; });
}

/* ---------------- methodology ---------------- */
/* Methodology: the headline's specification (nowcast.json production_v2, gdp_vintages). */
function v2MethodHTML() {
  var PV = NC.production_v2, hd = NC.headline; if (!PV || !PV.spec || !PV.spec.models) return "";
  var sp = PV.spec, d = sp.dfm || {}, u = sp.umidas || {}, g = sp.gdp || {}, src = sp.source || {}, V = NC.gdp_vintages || {}, R = PV.reproduction || {}, names = sp.production_names || {};
  var vacc = function (m) { var x = {}; (V.accuracy || []).forEach(function (a) { if (a.model === m && a.horizon === "pooled") x = a; }); return x; };
  var fields = (d.fields || []).map(function (f) { var v = varByField(f); return (v && v.name) || f; });
  var wd = sp.development_weights || {}, w = sp.weights || {}, M = sp.models;
  var p1 = "Source: IMRS's production repository (" + String(src.repository || "").replace(/^https:\/\//, "") + ", commit " + String(src.commit || "").slice(0, 7) + "; " + (src.version || "") + "), adopted as the Hub's headline on " + fmtDate(sp.adopted) + " at IMRS's request. Headline (" + (names[M.headline] || "") + ") = " + nf(w[M.dfm], 1) + " × factor model + " + nf(w[M.umidas], 1) + " × U-MIDAS; IMRS's development weights (" + nf(wd[M.dfm], 3) + " / " + nf(wd[M.umidas], 3) + ") are reported as a variant.";
  var p2 = "Factor model, production name " + (names[M.dfm] || "–") + ": one common factor of " + fields.length + " monthly series — " + fields.join("; ") + " — each standardised with its training mean and standard deviation. The panel starts in " + String(d.panel_start || "").slice(0, 7) + " and is balanced at its start; " + Object.keys(d.withheld || {}).map(function (f) { var v = varByField(f); return ((v && v.name) || f) + " is withheld " + d.withheld[f]; }).join("; ") + ". The factor follows an AR(" + (d.factor_order || 2) + ") process; the model (no idiosyncratic AR terms) is estimated by the EM algorithm of statsmodels' DynamicFactorMQ (at most " + ((d.em || {}).maxiter || 500) + " iterations, tolerance " + expFmt((d.em || {}).tolerance || 1e-5) + "), which the Hub re-implements and checks against statsmodels; no forecast is made when the EM has not converged or the factor's transition is not stable (spectral radius ≥ " + (d.max_spectral_radius || 0.9999) + "). The factor is the one-sided Kalman-filtered state (sign: the largest loading positive), so months not yet released are filled by the model. Its mean over the target quarter's three months is bridged to GDP growth: y(q) = c + a·f̄(q) + b·y(q−1), OLS on at least 12 quarters up to the quarter before the target, with at least " + (d.min_train_months || 36) + " months of panel.";
  var p3 = "U-MIDAS, production name " + (names[M.umidas] || "–") + ": y(t) = α + β·y(t−1) + Σ γ(l)·x(l), l = 0, 1, 2, where x are the last three monthly log changes of the USD/UZS rate available at the origin; at least " + (u.min_train || 15) + " training quarters.";
  var p4 = "GDP information set: both models train on GDP growth as SIAT had published it at each origin — for every quarter from " + (g.first_quarter || "2018Q3") + ", the latest figure published on or before the origin — taken from IMRS's documented record of stat.uz releases (" + (V.documented_events || "–") + " figures for 2018Q3–2026Q2; values and dates verified, figures flagged as possibly misread from a chart excluded) and, from the Hub's first run, every figure the Hub reads in SIAT table 3698 (dated by SIAT's update time). Every other model on the Hub trains on today's revised figures; the headline therefore aims at the first release, and is scored against it as well as against today's figures.";
  var hv = vacc(hd.model), pv = vacc((hd.previous || [])[0]), ht = hlAcc(hd.model, "pooled", "test"), pt = hlAcc((hd.previous || [])[0], "pooled", "test"), tst = winSpan("test");
  var p5 = "Accuracy on the Hub's record (" + (hv.first || "–") + "–" + (hv.last || "–") + ", H1–H3, standard lags, " + (hv.N || "–") + " forecasts): RMSE " + nf(hv.rmse_first, 3) + " pp against SIAT's first release and " + nf(hv.rmse_latest, 3) + " against today's figures; on the same quarters the previous headline (" + label((hd.previous || [])[0]) + ") " + nf(pv.rmse_first, 3) + " and " + nf(pv.rmse_latest, 3) + ". Test period " + tst[0] + "–" + tst[1] + ": " + nf(ht.rmse, 3) + " against " + nf(pt.rmse, 3) + ". The record has 15 quarters, so these differences are indicative; the headline's prospective validation starts with the first quarter published after its adoption.";
  var p6 = "Reproduction: the Hub runs the same specification on its own copies of the inputs and compares every run with the production repository's forecasts: " + (R.n_compared || 0) + " forecasts, largest difference " + expFmt(R.max_abs_diff) + " pp (" + (R.status || "–") + "). Inputs the Hub added for it: SIAT's industrial production volume index (table 577), the World Bank Pink Sheet gold price (now used by every Hub model in place of the earlier proxy) and the CBU bulletin's POS turnover for 2017–2019 (spliced to the 2020+ series).";
  return '<div class="wide"><b>The headline: IMRS production V2</b>' + [p1, p2, p3, p4, p5, p6].map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") + "</div>";
}
function renderMethod() {
  var el = body(), rr = PANEL.release_rule || {}, hd = NC.headline, bu = NC.bottom_up || {}, idn = bu.identity || {}, span = winSpan("all"), sel = winSpan("selection"), tst = winSpan("test");
  var line = ["H1", "H2", "H3", "pooled"].map(function (hz) { return (hz === "pooled" ? "all stages" : hz) + " " + nf(hlAcc(hd.model, hz).rmse, 3) + " (AR(2) " + nf(hlAcc("ar2", hz).rmse, 3) + ")"; }).join(", ");
  var h = '<div class="analysis">';
  h += "<div><b>Target</b><p>Real GDP growth, % of the same period of the previous year (SIAT table 3698), published about 31 days after the quarter. SIAT cumulates it from January (year to date): Q1 covers January–March, Q2 January–June, Q3 January–September and Q4 the whole year, so every Q4 value equals the annual growth rate. The nowcast target is the quarter after the latest published GDP.</p></div>";
  h += "<div><b>Information stages</b><p>" + esc(rr.horizons || "") + " " + esc("Standard rule: " + (rr.standard || "") + ". Conservative rule: " + (rr.conservative || "") + ".") + "</p></div>";
  h += "<div><b>Headline: " + esc(label(hd.model)) + "</b><p>" + esc(hd.formula + ". " + (hd.description || "") + " " + (hd.selection || "") + " Pseudo-real-time RMSE, " + span[0] + "–" + span[1] + ", standard lags: " + line + " pp. Indicative range: ± the headline's RMSE at the current stage (not a confidence interval).") + "</p></div>";
  h += v2MethodHTML();
  h += "<div><b>Target form: year to date or the quarter alone</b><p>" + esc("Because the target is cumulative, year-to-date growth y of a quarter combines the earlier quarters of the year, whose growth is already published, with the quarter itself: y(t) = (1 − w)·y(t−1) + w·g(t), where g is the growth of the quarter alone (% vs the same quarter a year earlier) and w the quarter's share in the previous year's GDP of the same months at current prices (tables siat-3695 and, before 2018, siat-3104). The benchmarks (historical mean, AR(1), AR(2)), the USD/UZS U-MIDAS and Almon models with their 50/50 ensemble, and the headline's two models are estimated on the published year-to-date growth (the headline's on the figures as published at each origin). Every other model is estimated in quarterly form: on g, the series that the months of its indicators describe, and its nowcast ĝ is converted with the published y(t−1), so an error in ĝ moves the year-to-date nowcast by only w times as much (w is about 0.57 in Q2, 0.38 in Q3 and 0.31 in Q4; 1 in Q1). The Calculations tab shows the conversion for every model.") + "</p></div>";
  h += "<div><b>Year-to-date bottom-up model</b><p>" + esc("GDP growth equals the share-weighted growth of the economy's sections (production identity; weights = each section's share in GDP over the same months of the previous year, current prices; it reproduces published GDP growth within " + nf(idn.max_abs_gap, 2) + " pp in " + (idn.quarters || "") + " quarters). The model starts from each section's published growth in the previous quarter of the year and moves industry, construction and trade by the change in SIAT's monthly year-to-date indices released since then; other sections keep their growth; for a first quarter it uses each section's mean annual growth over the last two years. Nothing is estimated. Most of the remaining error is in first quarters, where no earlier quarter of the year anchors the figure.") + "</p></div>";
  h += "<div><b>Models</b><p>Benchmarks (historical mean, AR(1), AR(2)); MIDAS regressions (U-MIDAS, Almon, exponential-Almon and Beta lag weights); bridge equations; dynamic factor models (principal components with one factor on Tier A, A–B and A–C indicators; Kalman filter with one factor; the headline's model with AR(2) factor dynamics, estimated by EM on eight series); Lasso and Elastic Net on quarterly and monthly designs; a Bayesian VAR with a Minnesota prior; the year-to-date bottom-up model; and combinations (fixed, equal and inverse-MSE weights), among them the headline and the two previous headlines. Experimental models (at present the Tier A–C factor model with satellite night-time lights) are estimated and scored in every run but stay out of the combinations and the headline until they are reviewed.</p></div>";
  var accAll = function (m) { var v = null; (NC.accuracy.rows || []).forEach(function (r) { if (r[0] === m && r[4] === "all" && r[5] === "standard" && r[6] === "pooled") v = r[8]; }); return v; };
  var REVISION = [   // pooled RMSE 2022Q1–2026Q2 (standard lags) of the specifications used until 1 October 2026
    ["ytd_combination", 0.604, "bottom-up member: a first quarter from the last two annual growth rates (was three)"],
    ["ytd_bottom_up", 0.644, "a first quarter from the last two annual growth rates (was three)"],
    ["dfm_kalman", 1.351, "quarterly form; one factor (was two)"],
    ["dfm_tierA_k1", 0.931, "quarterly form"], ["dfm_tierB_k1", 0.835, "quarterly form"], ["dfm_tierC_k1", 0.843, "quarterly form"],
    ["bridge_ar_invmse", 0.870, "quarterly form"], ["bridge_ar_mean", 0.924, "quarterly form"],
    ["midas_expalmon_mean", 0.850, "quarterly form"], ["midas_beta_mean", 0.876, "quarterly form"],
    ["lasso_bridge", 1.594, "quarterly form"], ["enet_bridge", 1.592, "quarterly form"], ["lasso_umidas", 1.421, "quarterly form"], ["enet_umidas", 1.444, "quarterly form"],
    ["bvar", 1.252, "quarterly form"], ["combo_invmse", 0.773, "members in quarterly form"], ["combo_equal", 0.877, "members in quarterly form"]
  ];
  var accW = function (m, w) { var v = null; (NC.accuracy.rows || []).forEach(function (r) { if (r[0] === m && r[4] === w && r[5] === "standard" && r[6] === "pooled") v = r[8]; }); return v; };
  h += '<div class="wide"><b>Re-specification of 2 October 2026 (the headline of that time: ensemble + bottom-up)</b><p>' + esc("Four changes were chosen on the selection period " + sel[0] + "–" + sel[1] + " and compared on the test period " + tst[0] + "–" + tst[1] + ": the quarterly form for the indicator models, one Kalman factor instead of two (0.64 against 0.85 RMSE on the selection period), the removal of the two-factor principal-components model (with at most 30 training quarters its second factor is not identified; its forecasts diverged to +331% and −140%, RMSE 56 pp) and a two-year instead of three-year trend for first quarters in the bottom-up model (RMSE of that headline " + nf(accW("ytd_combination", "selection"), 3) + " on the selection period against 0.604; the same comparison gave " + nf(accW("ytd_combination", "test"), 3) + " against 0.602 on the test period, so that period is not an untouched hold-out for this choice). That headline's structure was kept. Before the re-specification none of 16,663 equal-weight combinations of up to five models, nor inverse-MSE, best-past or top-k schemes with real-time weights, beat it in both periods; afterwards 3 of 2,300 two- and three-model combinations do, by at most 0.02 pp (for example the bottom-up model with the inverse-MSE average of the exponential-Almon MIDAS equations: 0.528 and 0.553). Gaps this small, found by searching over 18 quarters, are within noise, so they were not adopted. All other specifications were fixed before their accuracy was computed.") + "</p>";
  h += '<div class="tablewrap"><table class="data"><thead><tr><th>Model</th><th>RMSE before</th><th>RMSE now</th><th>Change</th><th style="text-align:left">What changed</th></tr></thead><tbody>' + REVISION.map(function (r) {
    var now = accAll(r[0]), ch = now == null ? null : 100 * (now / r[1] - 1);
    return "<tr><td>" + esc(label(r[0])) + "</td><td>" + r[1].toFixed(3) + "</td><td>" + (now == null ? "–" : now.toFixed(3)) + '</td><td><span class="badge' + (ch != null && ch < 0 ? " ok" : "") + '">' + (ch == null ? "–" : (ch > 0 ? "+" : "") + nf(ch, 0) + "%") + '</span></td><td style="text-align:left">' + esc(r[2]) + "</td></tr>";
  }).join("") + '</tbody></table></div><p class="muted" style="font-size:12.5px">' + esc("Pseudo-real-time RMSE, percentage points, pooled over H1–H3, standard lags, " + span[0] + "–" + span[1] + ". “Before”: the specifications used until 1 October 2026 on the data of 1 October 2026; “now”: this run. The benchmarks and the ensemble are unchanged (AR(2) " + nf(accAll("ar2"), 3) + ", ensemble " + nf(accAll("ensemble_ar2_umidas_usd"), 3) + ").") + "</p></div>";
  var recSpan = winSpan("record"), trn = trainingRule();
  var recFirstOf = function (m) { var v = null; (NC.accuracy.rows || []).forEach(function (r) { if (r[0] === m && r[4] === "record" && r[5] === "standard" && r[6] === "pooled" && r[7] > 0) v = r[12]; }); return v; };
  var starts = [["ar2", "AR benchmarks"], ["ytd_bottom_up", "year-to-date bottom-up model"], ["almon_usd_uzs_mom_dlog", "USD/UZS Almon MIDAS"], ["ytd_combination", "previous headlines, USD/UZS U-MIDAS and ensemble"], ["dfm_kalman", "factor, bridge, MIDAS and penalised models"], ["bvar", "BVAR"], [hd.model, "headline (IMRS production V2)"]].filter(function (s) { return recFirstOf(s[0]); }).map(function (s) { return s[1] + " " + recFirstOf(s[0]); }).join(", ");
  if (recSpan[0]) h += "<div><b>Track record from " + esc(recSpan[0]) + "</b><p>" + esc("Every model is evaluated on every quarter from " + recSpan[0] + " for which its own minimum training sample is met. From " + (trn.production_first || "2021Q1") + " every model trains on the GDP quarters from " + (trn.train_start || "2018Q1") + ": the 2017 currency unification changed the economy's dynamics, and adding 2016–2017 to these windows made the 2022–2026 forecasts less accurate (RMSE of the headline of that time 0.568 against 0.550, Kalman factor model 0.686 against 0.651). The early record " + recSpan[0] + "–" + prevQuarter(trn.production_first || "2021Q1") + " has no later history to train on, so its targets use every published quarter from " + (trn.early_train_start || "2016Q1") + " (for 2016–2017 SIAT table 3122, GDP growth by the expenditure method: the same total, equal to table 3698 to the published decimal in every quarter both cover); inverse-MSE weights use errors from " + recSpan[0] + " for those targets and from " + (trn.production_first || "2021Q1") + " afterwards. First quarter in the record (standard lags): " + starts + ". Models that need more training quarters than 12 can have gaps: the USD/UZS U-MIDAS (15 rows), its ensemble and the two previous headlines have forecasts for 2020 from the early record but none for 2021, because the production windows restart in " + (trn.train_start || "2018Q1") + " and reach 15 rows only for 2022Q1. The headline (IMRS production V2) has no early record: its GDP information set starts in 2018Q3 and its factor model's panel in 2019, so its U-MIDAS reaches 15 training quarters for 2022Q3 and its factor model 36 months for 2022Q1; 2022Q4 has no forecast because the factor model fails the stability check at those origins (as in IMRS's production run). The single-quarter growth g needs the previous year's quarterly nominal GDP, which starts in 2016, so the quarterly-form models train on g from 2017Q1. 2020, the pandemic year, is part of the record; its errors are large for every model, so compare models on the same quarters (÷ AR(2)).") + "</p></div>";
  (NC.experimental || []).forEach(function (ex) {
    h += "<div><b>Experimental model: " + esc(label(ex.model)) + "</b><p>" + esc(String(ex.spec || "").replace(/^experimental: (\w)/, function (_, c) { return c.toUpperCase(); }) + ". " + (ex.evidence || "") + " " + (ex.rule || "")) + "</p></div>";
  });
  h += "<div><b>Evaluation</b><p>" + esc("Expanding window, no look-ahead (standardisation, tuning and combination weights use only earlier data), errors = actual − forecast, RMSE relative to AR(2) on exactly the same quarters. Windows: all quarters " + span[0] + "–" + span[1] + "; selection period " + sel[0] + "–" + sel[1] + "; test period " + tst[0] + "–" + tst[1] + (recSpan[0] ? "; full record " + recSpan[0] + "–" + recSpan[1] + " (each model from its first quarter)" : "") + ". Whether a model beats AR(2) by more than chance is judged with the Diebold–Mariano test (squared errors, Harvey–Leybourne–Newbold small-sample correction, one-sided).") + "</p></div>";
  h += "<div><b>Calculations</b><p>Every model, for any target quarter, stage and release rule, can be opened in the Calculations tab: the variables and months it uses at the forecast origin, the design matrix, each estimation step (OLS algebra, lag weights, factors, penalty path, posterior, combination weights), the nowcast term by term, fitted values and the pseudo-real-time track record, with an Excel download. The model is re-estimated in the browser and checked against the published run.</p></div>";
  h += "<div><b>Limitations</b><p>" + esc((NC.notes || []).join(" ")) + "</p></div></div>";
  el.innerHTML = h;
}

window.NOWCAST = { render: render, go: go, rerender: function () { if (NC) render(); } };
})();
