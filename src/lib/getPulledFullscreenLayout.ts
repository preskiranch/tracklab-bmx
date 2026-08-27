export const getPulledFullscreenStyles = `
.get-pulled-fullscreen-actions{position:fixed;top:max(12px,calc(env(safe-area-inset-top) + 12px));right:max(12px,calc(env(safe-area-inset-right) + 12px));z-index:2147483002;display:grid;gap:7px;width:208px}
.get-pulled-exit-fullscreen,.get-pulled-end-session-fullscreen{position:static;display:inline-flex;align-items:center;justify-content:flex-start;gap:7px;box-sizing:border-box;width:100%;min-height:44px;padding:0 14px;border:1px solid rgba(255,255,255,.3);border-radius:10px;background:rgba(7,14,10,.9);color:#fff;font:inherit;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.get-pulled-end-session-fullscreen{border-color:rgba(255,205,198,.58);color:#ffe1dc}
.get-pulled-exit-fullscreen:disabled,.get-pulled-end-session-fullscreen:disabled{opacity:.58;cursor:not-allowed}
.utility-fullscreen .get-pulled-overlay{inset:max(12px,env(safe-area-inset-top)) max(232px,calc(env(safe-area-inset-right) + 232px)) auto max(12px,calc(env(safe-area-inset-left) + 12px));display:flex;width:fit-content;max-width:calc(100vw - max(12px,calc(env(safe-area-inset-left) + 12px)) - max(232px,calc(env(safe-area-inset-right) + 232px)));gap:0;align-items:stretch;overflow:hidden;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(8,15,13,.88);box-shadow:0 10px 28px rgba(0,0,0,.28);backdrop-filter:blur(10px)}
.utility-fullscreen .get-pulled-timer,.utility-fullscreen .get-pulled-phase{min-width:0;max-width:100%;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none}
.utility-fullscreen .get-pulled-timer{flex:0 1 auto}
.utility-fullscreen .get-pulled-timer small{max-width:330px;line-height:1.25;overflow-wrap:anywhere}
.utility-fullscreen .get-pulled-phase{flex:0 1 360px;border-left:1px solid rgba(255,255,255,.16)}
.utility-fullscreen .get-pulled-phase strong,.utility-fullscreen .get-pulled-phase small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:640px){
  .utility-fullscreen .get-pulled-overlay{right:max(72px,calc(env(safe-area-inset-right) + 72px));max-width:calc(100vw - max(12px,calc(env(safe-area-inset-left) + 12px)) - max(72px,calc(env(safe-area-inset-right) + 72px)))}
  .utility-fullscreen .get-pulled-timer{padding:8px 10px}
  .utility-fullscreen .get-pulled-timer strong{font-size:clamp(30px,10vw,44px)}
  .utility-fullscreen .get-pulled-timer small{font-size:9px;letter-spacing:.05em}
  .get-pulled-fullscreen-actions{width:48px}
  .get-pulled-exit-fullscreen,.get-pulled-end-session-fullscreen{padding:0;justify-content:center}
  .get-pulled-exit-fullscreen span,.get-pulled-end-session-fullscreen span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
}`;
