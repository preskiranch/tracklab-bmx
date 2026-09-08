'use strict';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.hash.slice(1));
let purpose=params.has('reset')?'reset':'verify';
let token=params.get(purpose)||'';
if(!/^[a-f0-9]{64}$/.test(token)) token='';
// Remove the secret from the address bar before any interaction.
history.replaceState(null,'',location.pathname);
let busy=false;let cooldown=0;
function render(){
 $('title').textContent=purpose==='reset'?'Reset your password':'Verify your email';
 $('description').textContent=token?(purpose==='reset'?'Choose a new password for your account.':'Confirm your email, then return to TrackLab to sign in.'):'Enter the email address you used for TrackLab.';
 $('email-label').hidden=Boolean(token);$('email').required=!token;
 $('password-label').hidden=!(token&&purpose==='reset');$('confirm-label').hidden=!(token&&purpose==='reset');
 $('password').required=Boolean(token&&purpose==='reset');$('confirm').required=$('password').required;
 $('new-email-label').hidden=purpose!=='correct';$('new-email').required=purpose==='correct';
 if(purpose==='correct'){ $('title').textContent='Correct signup email';$('description').textContent='For an account you have not verified yet. Enter the email you signed up with, the correct email, and your existing password.';$('password-label').hidden=false;$('password').required=true; }
 $('submit').textContent=token?(purpose==='reset'?'Save new password':'Verify email'):'Send email';
 $('password-label').firstChild.textContent=purpose==='correct'?'Account password':'New password';$('password').autocomplete=purpose==='correct'?'current-password':'new-password';
 $('submit').disabled=busy||(!token&&Date.now()<cooldown);$('form').hidden=false;
}
function requestMode(next){if(busy)return;purpose=next;token='';$('status').textContent='';render();$('email').focus();}
$('correct').onclick=()=>requestMode('correct');
$('resend').onclick=()=>requestMode('verify');$('reset').onclick=()=>requestMode('reset');
$('form').onsubmit=async event=>{
 event.preventDefault();if(busy)return;
 if(token&&purpose==='reset'&&$('password').value!==$('confirm').value){$('status').textContent='The passwords do not match.';return;}
 busy=true;render();$('status').textContent='Please wait…';
 try{
  const completing=Boolean(token);
  const response=await fetch(purpose==='correct'?'/api/auth/email-correct':completing?'/api/auth/email-complete':'/api/auth/email-request',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({purpose,...(completing?{token,password:$('password').value}:{email:$('email').value.trim(),newEmail:$('new-email').value.trim(),password:purpose==='correct'?$('password').value:undefined})})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Please try again.');
  $('status').textContent=data.message;
  if(completing){token='';$('password').value='';$('confirm').value='';$('form').hidden=true;}
  else {cooldown=Date.now()+60000;setTimeout(()=>{if(!busy)$('submit').disabled=false;},60000);}
 }catch(error){$('status').textContent=error.message;}
 finally{busy=false;$('submit').disabled=!token&&Date.now()<cooldown;}
};render();

window.addEventListener('hashchange',()=>{
 if(busy || !location.hash)return;
 const next=new URLSearchParams(location.hash.slice(1));purpose=next.has('reset')?'reset':'verify';token=next.get(purpose)||'';
 if(!/^[a-f0-9]{64}$/.test(token))token='';
 history.replaceState(null,'',location.pathname);$('status').textContent='';render();
});
