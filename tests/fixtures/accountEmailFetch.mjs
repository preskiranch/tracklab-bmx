import { appendFileSync } from 'node:fs';
const originalFetch=globalThis.fetch;
if(process.env.NODE_ENV==='test' && process.env.TRACKLAB_TEST_EMAIL_CAPTURE){
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails'){
   appendFileSync(process.env.TRACKLAB_TEST_EMAIL_CAPTURE,options.body+'\n');return new Response('{"id":"test-mail"}',{status:200});
  }
  return originalFetch(url,options);
 };
}
