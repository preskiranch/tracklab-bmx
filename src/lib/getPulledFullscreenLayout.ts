export const getPulledFullscreenStyles = `
.utility-fullscreen .get-pulled-view{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;grid-template-rows:minmax(0,1fr) auto;grid-auto-rows:auto;gap:clamp(6px,1.2vh,12px);gap:clamp(6px,1.2dvh,12px);padding:max(10px,calc(env(safe-area-inset-top,0px) + 10px)) max(10px,calc(env(safe-area-inset-right,0px) + 10px)) max(10px,calc(env(safe-area-inset-bottom,0px) + 10px)) max(10px,calc(env(safe-area-inset-left,0px) + 10px));background:#07100b}
.utility-fullscreen .get-pulled-hero{height:100%;min-height:0;overflow:hidden}
.utility-fullscreen .get-pulled-hero>.pull-sled-scene{height:100%!important;min-height:0!important}
.utility-fullscreen .get-pulled-config,.utility-fullscreen .get-pulled-privacy{display:none}
.utility-fullscreen .get-pulled-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))!important;align-items:stretch;gap:clamp(4px,.65vw,8px);min-width:0}
.utility-fullscreen .get-pulled-metric{box-sizing:border-box;display:grid;grid-template-columns:auto auto;grid-template-rows:auto auto;align-items:center;align-content:center;justify-content:center;column-gap:5px;row-gap:2px;min-width:0;min-height:64px;max-height:84px;overflow:hidden;padding:6px 8px;border-radius:10px}
.utility-fullscreen .get-pulled-metric>svg{grid-column:1;grid-row:1;width:16px;height:16px}
.utility-fullscreen .get-pulled-metric>strong{grid-column:2;grid-row:1;min-width:max-content;white-space:nowrap;font-size:clamp(24px,2.4vw,34px);line-height:1.125}
.utility-fullscreen .get-pulled-metric>small{display:block;grid-column:1/-1;grid-row:2;max-width:100%;max-height:2.2em;overflow:hidden;overflow-wrap:anywhere;text-align:center;white-space:normal;font-size:clamp(10px,.9vw,12px);line-height:1.1}
.utility-fullscreen .get-pulled-results{padding:4px 6px}
.utility-fullscreen .get-pulled-results .get-pulled-heart-rate-summary>small{max-height:2.2em;white-space:normal}
.utility-fullscreen .get-pulled-metrics>.heart-rate-metric{box-sizing:border-box;display:grid;grid-template-columns:auto auto;grid-template-rows:auto auto;align-items:center;align-content:center;justify-content:center;column-gap:5px;row-gap:2px;width:100%;height:auto;min-width:0;min-height:64px;max-height:84px;overflow:hidden;padding:6px 8px;border-radius:10px}
.utility-fullscreen .get-pulled-metrics>.heart-rate-metric>svg{grid-column:1;grid-row:1;width:16px;height:16px}
.utility-fullscreen .get-pulled-metrics>.heart-rate-metric>span{display:contents}
.utility-fullscreen .get-pulled-metrics>.heart-rate-metric strong{grid-column:2;grid-row:1;min-width:max-content;white-space:nowrap;font-size:clamp(24px,2.4vw,34px);line-height:1.125}
.utility-fullscreen .get-pulled-metrics>.heart-rate-metric small{display:block;grid-column:1/-1;grid-row:2;margin-top:0;max-width:100%;max-height:2.2em;overflow:hidden;overflow-wrap:anywhere;text-align:center;text-overflow:clip;white-space:normal;font-size:clamp(10px,.9vw,12px);line-height:1.1}
.get-pulled-fullscreen-actions{position:fixed;top:max(12px,calc(env(safe-area-inset-top,0px) + 12px));right:max(12px,calc(env(safe-area-inset-right,0px) + 12px));z-index:2147483002;display:grid;gap:7px;width:208px}
.get-pulled-exit-fullscreen,.get-pulled-end-session-fullscreen{position:static;display:inline-flex;align-items:center;justify-content:flex-start;gap:7px;box-sizing:border-box;width:100%;min-height:44px;padding:0 14px;border:1px solid rgba(255,255,255,.3);border-radius:10px;background:rgba(7,14,10,.9);color:#fff;font:inherit;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.get-pulled-end-session-fullscreen{border-color:rgba(255,205,198,.58);color:#ffe1dc}
.get-pulled-exit-fullscreen:disabled,.get-pulled-end-session-fullscreen:disabled{opacity:.58;cursor:not-allowed}
.utility-fullscreen .get-pulled-overlay{inset:max(12px,calc(env(safe-area-inset-top,0px) + 12px)) max(232px,calc(env(safe-area-inset-right,0px) + 232px)) auto max(12px,calc(env(safe-area-inset-left,0px) + 12px));display:flex;width:fit-content;max-width:calc(100vw - max(12px,calc(env(safe-area-inset-left,0px) + 12px)) - max(232px,calc(env(safe-area-inset-right,0px) + 232px)));gap:0;align-items:stretch;overflow:hidden;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(8,15,13,.88);box-shadow:0 10px 28px rgba(0,0,0,.28);backdrop-filter:blur(10px)}
.utility-fullscreen .get-pulled-timer,.utility-fullscreen .get-pulled-phase{min-width:0;max-width:100%;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none}
.utility-fullscreen .get-pulled-timer{flex:0 1 auto}
.utility-fullscreen .get-pulled-timer small{max-width:330px;line-height:1.25;overflow-wrap:anywhere}
.utility-fullscreen .get-pulled-phase{flex:0 1 360px;border-left:1px solid rgba(255,255,255,.16)}
.utility-fullscreen .get-pulled-phase strong,.utility-fullscreen .get-pulled-phase small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:699px) and (orientation:portrait){
  .utility-fullscreen .get-pulled-metrics{grid-template-columns:repeat(3,minmax(0,1fr))!important}
}
@media(max-width:359px) and (orientation:portrait){
  .utility-fullscreen .get-pulled-metric,.utility-fullscreen .get-pulled-metrics>.heart-rate-metric{min-height:54px;max-height:64px;padding:4px 6px}
  .utility-fullscreen .get-pulled-results{padding:3px 4px}
}
@media(max-height:500px) and (orientation:landscape){
  .utility-fullscreen .get-pulled-view{gap:6px;padding-top:max(6px,calc(env(safe-area-inset-top,0px) + 6px));padding-right:max(6px,calc(env(safe-area-inset-right,0px) + 6px));padding-bottom:max(6px,calc(env(safe-area-inset-bottom,0px) + 6px));padding-left:max(6px,calc(env(safe-area-inset-left,0px) + 6px))}
  .utility-fullscreen .get-pulled-metrics{grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:4px}
  .utility-fullscreen .get-pulled-metric{grid-template-columns:1fr;min-height:52px;max-height:58px;padding:4px}
  .utility-fullscreen .get-pulled-metric>svg{display:none}
  .utility-fullscreen .get-pulled-metric>strong{grid-column:1;font-size:clamp(18px,6vh,24px);font-size:clamp(18px,6dvh,24px)}
  .utility-fullscreen .get-pulled-metric>small{font-size:9px}
  .utility-fullscreen .get-pulled-metrics>.heart-rate-metric{min-height:52px;max-height:58px;padding:4px;gap:4px}
  .utility-fullscreen .get-pulled-metrics>.heart-rate-metric>svg{display:none}
  .utility-fullscreen .get-pulled-metrics>.heart-rate-metric strong{font-size:clamp(18px,6vh,24px);font-size:clamp(18px,6dvh,24px)}
  .utility-fullscreen .get-pulled-metrics>.heart-rate-metric small{font-size:9px}
}
@media(max-height:360px) and (orientation:landscape){
  .utility-fullscreen .get-pulled-view{gap:4px;padding-top:max(4px,calc(env(safe-area-inset-top,0px) + 4px));padding-right:max(4px,calc(env(safe-area-inset-right,0px) + 4px));padding-bottom:max(4px,calc(env(safe-area-inset-bottom,0px) + 4px));padding-left:max(4px,calc(env(safe-area-inset-left,0px) + 4px))}
  .utility-fullscreen .get-pulled-metrics{gap:3px}
  .utility-fullscreen .get-pulled-metric,.utility-fullscreen .get-pulled-metrics>.heart-rate-metric{min-height:44px;max-height:48px;padding:2px 3px}
  .utility-fullscreen .get-pulled-metric>strong,.utility-fullscreen .get-pulled-metrics>.heart-rate-metric strong{font-size:20px}
  .utility-fullscreen .get-pulled-metric>small,.utility-fullscreen .get-pulled-metrics>.heart-rate-metric small{font-size:9px}
  .utility-fullscreen .get-pulled-results{padding:2px 4px}
}
@media(max-width:640px){
  .utility-fullscreen .get-pulled-overlay{right:max(72px,calc(env(safe-area-inset-right,0px) + 72px));max-width:calc(100vw - max(12px,calc(env(safe-area-inset-left,0px) + 12px)) - max(72px,calc(env(safe-area-inset-right,0px) + 72px)))}
  .utility-fullscreen .get-pulled-timer{padding:8px 10px}
  .utility-fullscreen .get-pulled-timer strong{font-size:clamp(30px,10vw,44px)}
  .utility-fullscreen .get-pulled-timer small{font-size:9px;letter-spacing:.05em}
  .get-pulled-fullscreen-actions{width:48px}
  .get-pulled-exit-fullscreen,.get-pulled-end-session-fullscreen{padding:0;justify-content:center}
  .get-pulled-exit-fullscreen span,.get-pulled-end-session-fullscreen span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
}`;
