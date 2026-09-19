const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, form, filler, settle } = require('./extension.cjs');
const { context, run, element } = require('./harness.cjs');
const { scraper } = require('./baseline.test.cjs');
const bytes = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1]);
const response = (status=200, body=bytes, type='image/jpeg') => new Response(body,{status,headers:{'content-type':type}});
async function ready(urls=['https://cs.copart.com/a.jpg']) {
  const e = extension(); const job = await e.start(await e.capture(1,car('12345',{images:urls}))); const sender=e.fromTab(job.destinationTabId);
  await e.send({action:'CLAIM_TRANSFER',transferId:job.id},sender); await e.send({action:'FORM_FILLED',transferId:job.id},sender);
  return {e,job,sender};
}
function transport(e, fetch) {
  const ctx = context({chrome:e.chrome,fetch,FileReader:class { readAsDataURL(blob) { blob.arrayBuffer().then(buf=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buf).toString('base64');this.onloadend();}); } }});
  ctx.AutoImportTransfers=e.api; run('background/images.js',ctx);
  return require('node:vm').runInContext('AutoImportImageFetch',ctx);
}
test('Copart discovers only current-lot image branches and preserves signed URL exactly', async()=>{
 const signed='https://cs.copart.com/a.jpg?token=a%2Fb%2Bc&expires=123';
 const d=await scraper('content_scripts/copart_scraper.js',{title:'2020 BMW X5',hidden:{__NEXT_DATA__:{textContent:JSON.stringify({lot:{ln:12345,lcy:2020,mkn:'BMW',mdn:'X5',images:[signed,signed,'not a url'],related:{images:['https://cs.copart.com/other.jpg']}},recommendations:{ln:999,images:['https://cs.copart.com/b.jpg']}})}}});
 assert.deepEqual(Array.from(d.images),[signed]);
});
test('IAAI chooses existing largest variant without changing signed query',async()=>{
 const urls=[100,800].map(w=>`https://vis.iaai.com/resizer?imageKeys=12345~SID~1~I1~RW100&width=${w}&height=400&sig=abc%2F123`);
 const images=urls.map(src=>({src,getAttribute(){return '';}}));
 const d=await scraper('content_scripts/iaai_scraper.js',{title:'2020 BMW X5',hidden:{hdnRequestedItemID:{value:'12345'}},images});
 assert.deepEqual(Array.from(d.images),[urls[1]]);
});
test('fetch retries transient HTTP failure, preserves URL, persists no binaries',async()=>{
 const url='https://cs.copart.com/a.jpg?sig=a%2Fb'; const {e,job,sender}=await ready([url]); let calls=0;
 const t=transport(e,async(actual)=>{assert.equal(actual,url);return response(++calls===1?503:200);});
 const result=await t.fetchImage({transferId:job.id,url},sender);
 assert.equal(result.success,true); assert.equal(calls,2);
 const saved=e.store.values.importState.transfers[job.destinationTabId]; assert.equal(saved.imageItems[0].state,'fetched'); assert.equal(saved.imageItems[0].attempts,2);
 assert.doesNotMatch(JSON.stringify(saved),/base64|data:image/);
});
test('404, HTML, oversized and malformed URLs fail safely; transient retries are bounded',async()=>{
 for(const [status,type,expected] of [[404,'image/jpeg',1],[200,'text/html',1],[503,'image/jpeg',3]]) {
  const {e,job,sender}=await ready();let calls=0;const t=transport(e,async()=>{calls++;return response(status,bytes,type);});
  await assert.rejects(t.fetchImage({transferId:job.id,url:job.data.images[0]},sender)); assert.equal(calls,expected);
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].imageItems[0].state,'failed');
 }
 const {e}=await ready(); const t=transport(e,()=>{});
 await assert.rejects(t.imageBlob(new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':'20000000'}})),/10 MB/);
 const ctx=context();run('shared/images.js',ctx);
 for(const u of ['javascript:alert(1)','https://user:pass@cs.copart.com/a.jpg','https://evil.test/a.jpg','https://cs.copart.com:444/a.jpg','%ZZ']) assert.equal(ctx.AutoImportImages.validUrl(u),false);
});
test('global fetch concurrency is two, duplicate fetch is shared, cancellation aborts work',async()=>{
 const {e,job,sender}=await ready(['https://cs.copart.com/a.jpg','https://cs.copart.com/b.jpg','https://cs.copart.com/c.jpg']);
 let running=0,max=0,calls=0; const gates=[];
 const t=transport(e,async(_url,options)=>{calls++;running++;max=Math.max(max,running);await new Promise((resolve,reject)=>{gates.push(resolve);options.signal.addEventListener('abort',()=>reject(Error('aborted')));});running--;return response();});
 const jobs=job.data.images.map(url=>t.fetchImage({transferId:job.id,url},sender));
 const duplicate=t.fetchImage({transferId:job.id,url:job.data.images[0]},sender); const all=Promise.allSettled([...jobs,duplicate]);
 await settle();assert.equal(max,2);assert.equal(calls,2);
 await e.send({action:'CANCEL_JOB',transferId:job.id}); const outcomes=await all;
 assert.ok(outcomes.every(r=>r.status==='rejected'));assert.equal(calls,2);
 assert.ok(e.store.values.importState.transfers[job.destinationTabId].imageItems.every(i=>i.state==='cancelled'));
});
function uploadPage(e,job,failIndex=-1,fetchTransport=null) {
 const page=form();page.document.fileInput=element();page.document.fileInput.files=[];const rows=[];
 const originalQuery=page.document.querySelector;
 page.document.querySelector=s=>s==='.dropzone'?{}:s==='.dz-preview'?rows[0]||null:originalQuery(s);
 const originalAll=page.document.querySelectorAll;
 page.document.querySelectorAll=s=>s==='.dz-preview'?rows:originalAll(s);
 page.document.fileInput.dispatchEvent=()=>{
  rows.length=0;
  page.document.fileInput.files.forEach((f,i)=>rows.push({classList:{contains:name=>name===(i===failIndex?'dz-error':'dz-success')},querySelector:s=>({textContent:s==='[data-dz-name]'?f.name:'Rejected by server'})}));
 };
 const base=e.send; e.send=async(msg,sender)=>msg.action==='FETCH_IMAGE_AS_BASE64'?(fetchTransport ? fetchTransport.fetchImage(msg,sender).catch(error=>({success:false,error:error.message})) : {success:true,dataUrl:'data:image/jpeg;base64,aQ==',mimeType:'image/jpeg'}):base(msg,sender);
 const input=page.document.fileInput; delete page.document.fileInput;
 const f=filler(e,job,page,{fetch:async()=>({blob:async()=>new Blob([bytes],{type:'image/jpeg'})}),DataTransfer:class{constructor(){this.files=[];this.items={add:f=>this.files.push(f)}}}});
 return {page,f,rows,input};
}
for(const failed of [-1,1]) test('uploader fixture reports '+(failed<0?'full success':'partial rejection')+' and retries only failed files',async()=>{
 const {e,job}=await ready(['https://cs.copart.com/a.jpg','https://cs.copart.com/b.jpg']);const {page,f,input}=uploadPage(e,job,failed);await settle();page.document.fileInput=input;
 // Panel nodes are absent in this fixture, use direct button handler workflow.
 const result=await f.ctx.testHooks.autoUploadImages(job.data.images,element());
 const saved=e.store.values.importState.transfers[job.destinationTabId];
 assert.equal(result,true);assert.equal(saved.imageResult.uploaded,failed<0?2:1);assert.equal(saved.imageResult.outcome,failed<0?'complete':'partial');
 page.document.fileInput.files=[];
 if(failed>=0){assert.equal(await f.ctx.testHooks.autoUploadImages(job.data.images,element()),true);assert.equal(page.document.fileInput.files.length,1);assert.match(page.document.fileInput.files[0].name,/_02_r1\.jpg$/);}
 else assert.equal(await f.ctx.testHooks.autoUploadImages(job.data.images,element()),false);
});
test('summary never treats 29 of 30 as complete',()=>{
 const ctx=context();run('shared/images.js',ctx);
 const items=Array.from({length:30},(_,i)=>({state:i===29?'failed':'uploaded'}));
 assert.equal(ctx.AutoImportImages.summary(items).outcome,'partial');
 items[29].state='uploaded';assert.equal(ctx.AutoImportImages.summary(items).outcome,'complete');
});

test('unconfirmed assignments survive reload and are not fetched or submitted twice',async()=>{
 const {e,job,sender}=await ready();
 await e.send({action:'IMAGE_STATE',transferId:job.id,url:job.data.images[0],state:'fetched'},sender);
 await e.send({action:'IMAGE_STATE',transferId:job.id,url:job.data.images[0],state:'uploading'},sender);
 const {page,f,input}=uploadPage(e,job);await settle();page.document.fileInput=input;
 assert.equal(e.store.values.importState.transfers[job.destinationTabId].imageItems[0].state,'unconfirmed');
 assert.equal(await f.ctx.testHooks.autoUploadImages(job.data.images,element()),false);
 assert.equal(input.files.length,0);
 await assert.rejects(e.api.authorizeImage({transferId:job.id,url:job.data.images[0]},sender));
});

test('Copart merges carousel photos with structured lead image and rejects other lots on A -> B',async()=>{
 const {event}=require('./harness.cjs');
 let lot='12345';
 const photo=(src,attrs={},parentElement=null)=>({src,parentElement,getAttribute:key=>attrs[key]||''});
 const ctx=context({location:{href:'https://www.copart.com/lot/12345'},chrome:{runtime:{onMessage:event()}},document:{
  getElementById:()=>({textContent:JSON.stringify({lot:{ln:lot,images:[`https://cs.copart.com/${lot}-lead.jpg`],imgList:['//cs.copart.com/'+lot+'-extra.jpg?sig=a%2Fb'],nested:{ln:'999',images:['https://cs.copart.com/foreign.jpg']}}})}),
  querySelector:s=>s==='h1'?{innerText:'2020 BMW X5'}:null,
  body:{innerText:'',querySelectorAll:s=>s.includes('.slick-slider img')?[
   photo(`https://cs.copart.com/${lot}-gallery.jpg?sig=x%2By`,{'data-src':'data:image/gif;base64,placeholder'}),
   photo('https://cs.copart.com/wrong.jpg',{},photo('',{'data-lot-number':'999'})),
   photo('https://cs.copart.com/related.jpg',{}, {className:'related-carousel',getAttribute:()=>''}),
   photo('https://cs.copart.com/linked.jpg',{},photo('',{href:'/lot/999'}))
  ]:[]}
 }});
 run('content_scripts/copart_scraper.js',ctx,['scrape']);
 for(const id of ['12345','67890']) {
  lot=id;ctx.location.href='https://www.copart.com/lot/'+id;
  const data=await ctx.testHooks.scrape();
  assert.deepEqual(Array.from(data.images),[`https://cs.copart.com/${id}-lead.jpg`,`https://cs.copart.com/${id}-extra.jpg?sig=a%2Fb`,`https://cs.copart.com/${id}-gallery.jpg?sig=x%2By`]);
 }
});

test('IAAI placeholder lazy URL does not hide current image and other lot remains excluded',async()=>{
 const url='https://vis.iaai.com/resizer?imageKeys=12345~SID~1~I1~RW100&width=800&sig=a%2Fb';
 const d=await scraper('content_scripts/iaai_scraper.js',{title:'2020 BMW X5',hidden:{hdnRequestedItemID:{value:'12345'}},images:[
  {src:url,getAttribute:()=> 'data:image/gif;base64,placeholder'},
  {src:url.replace('12345~','999~'),getAttribute:()=>''}
 ]});
 assert.deepEqual(Array.from(d.images),[url]);
});

test('relative image resolution keeps signatures and rejects unsupported hosts and schemes',()=>{
 const ctx=context();run('shared/images.js',ctx);
 const resolve=ctx.AutoImportImages.resolveUrl;
 assert.equal(resolve('//cs.copart.com/a.jpg?sig=a%2Fb&x=1','https://www.copart.com/lot/12345'),'https://cs.copart.com/a.jpg?sig=a%2Fb&x=1');
 for(const value of ['//evil.test/a.jpg','javascript:alert(1)','data:image/png;base64,x','http://cs.copart.com/a.jpg']) assert.equal(resolve(value,'https://www.copart.com/lot/12345'),'');
});
test('17 of 20 accepted images stays partial with explicit excluded count',()=>{
 const ctx=context();run('shared/images.js',ctx);const job={id:'x',data:{images:Array.from({length:20},(_,i)=>'https://cs.copart.com/'+i+'.jpg')}};
 const items=ctx.AutoImportImages.ensure(job);items.filter(i=>i.state==='pending').forEach(i=>i.state='uploaded');
 const result=ctx.AutoImportImages.summary(items);assert.equal(result.outcome,'partial');assert.equal(result.uploaded,17);assert.equal(result.excluded,3);
});
test('redirect and fake image content fail permanently instead of silently becoming files',async()=>{
 for(const r of [new Response(null,{status:302,headers:{location:'https://evil.test/a.jpg'}}),response(200,new TextEncoder().encode('<html>error</html>'))]) {
  const {e,job,sender}=await ready();let calls=0;const t=transport(e,async()=>{calls++;return r;});
  await assert.rejects(t.fetchImage({transferId:job.id,url:job.data.images[0]},sender));assert.equal(calls,1);
 }
});
for(const source of ['copart','iaai']) for(const failure of [-1,1]) test(`${source} extraction through actual fetch state to uploader ${failure<0?'complete':'partial'} fixture`,async()=>{
 const urls=source==='copart'?['https://cs.copart.com/a.jpg?sig=a%2F1','https://cs.copart.com/b.jpg?sig=b%2F1']:[1,2].map(n=>`https://vis.iaai.com/resizer?imageKeys=12345~SID~1~I${n}~RW100&sig=a%2F1`);
 const hidden=source==='copart'?{__NEXT_DATA__:{textContent:JSON.stringify({lot:{ln:12345,lcy:2020,mkn:'BMW',mdn:'X5',images:urls}})}}:{hdnRequestedItemID:{value:'12345'}};
 const data=await scraper(`content_scripts/${source}_scraper.js`,{title:'2020 BMW X5',hidden,images:urls.map(src=>({src,getAttribute(){return '';}}))});
 const e=extension();const job=await e.start(await e.capture(1,data));const sender=e.fromTab(job.destinationTabId);
 await e.send({action:'CLAIM_TRANSFER',transferId:job.id},sender);await e.send({action:'FORM_FILLED',transferId:job.id},sender);
 const t=transport(e,async()=>response());const {f,input,page}=uploadPage(e,job,failure,t);await settle();page.document.fileInput=input;
 assert.equal(await f.ctx.testHooks.autoUploadImages(job.data.images,element()),true);
 const saved=e.store.values.importState.transfers[job.destinationTabId];
 assert.equal(saved.imageResult.outcome,failure<0?'complete':'partial');assert.equal(saved.imageItems[0].attempts,1);
});
test('body without content-length is bounded while streaming',async()=>{
 const {e}=await ready();const t=transport(e,()=>{});
 await assert.rejects(t.imageBlob(response(200,new Uint8Array(10*1024*1024+1))),/10 MB/);
});
test('decoded bitmap is closed on both validation success and dimension rejection',async()=>{
 const {e}=await ready();let closed=0,wide=false;
 const ctx=context({chrome:e.chrome,createImageBitmap:async()=>({width:wide?100000:1,height:1000,close(){closed++;}})});ctx.AutoImportTransfers=e.api;run('background/images.js',ctx);
 const t=require('node:vm').runInContext('AutoImportImageFetch',ctx);
 await t.imageBlob(response());wide=true;await assert.rejects(t.imageBlob(response()),/40 мегапиксела/);assert.equal(closed,2);
});
