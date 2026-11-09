// Блокировщик рекламы: сетевые правила + скрытие баннеров.
// Списки можно свободно дополнять.
const BLOCK = [
  // реклама и трекеры третьих сторон
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.adservice.google.com/*',
  '*://*.google-analytics.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.adnxs.com/*',
  '*://*.criteo.com/*',
  '*://*.criteo.net/*',
  '*://*.rubiconproject.com/*',
  '*://*.pubmatic.com/*',
  '*://*.openx.net/*',
  '*://*.moatads.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.adsrvr.org/*',
  '*://*.taboola.com/*',
  '*://*.outbrain.com/*',
  // аудиореклама SoundCloud
  '*://api-v2.soundcloud.com/audio-ads*'
];

const CSS = `
  iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
  ins.adsbygoogle, .adsbygoogle, [id^="google_ads"],
  .adBanner, [class*="adBanner"], [class*="AdBanner"], [class*="audioAd"] {
    display: none !important;
  }
`;

function install(ses, isEnabled) {
  ses.webRequest.onBeforeRequest({ urls: BLOCK }, (_details, cb) => cb({ cancel: isEnabled() }));
}

function injectCss(wc, isEnabled) {
  wc.on('dom-ready', () => { if (isEnabled()) wc.insertCSS(CSS).catch(() => {}); });
}

module.exports = { install, injectCss };
