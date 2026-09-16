import {chromium,webkit} from '@playwright/test';
for(const [name,type] of [['chromium',chromium],['webkit',webkit]] as const){
 const browser=await type.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
  async function reset(){await page.goto('https://audit.invalid/');await page.addScriptTag({path:'/tmp/student-answer-audit.bundle.js'});await page.getByRole('textbox',{name:'Writing response',exact:true}).waitFor();}
  const results:any={browser:name};
  await reset();
  await page.getByRole('textbox',{name:'Writing response',exact:true}).fill('ordinary answer');
  await page.getByRole('textbox',{name:'Objective probe'}).click();
  results.normalBlur=await page.evaluate(()=>({commits:(window as any).audit.commits,latest:(window as any).audit.latest}));
  await reset();
  await page.getByRole('textbox',{name:'Writing response',exact:true}).fill('new');
  await page.evaluate(()=>{(window as any).audit.bump();});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Objective probe"]')?.getAttribute('data-n')==='1');
  await page.evaluate(()=>{(window as any).audit.show(false);});
  await page.getByRole('textbox',{name:'Writing response',exact:true}).waitFor({state:'detached'});
  results.shorterUnmount=await page.evaluate(()=>({commits:(window as any).audit.commits,latest:(window as any).audit.latest}));
  await reset();
  await page.getByRole('textbox',{name:'Writing response',exact:true}).fill('task one revised');
  await page.getByRole('button',{name:'Task 2',exact:true}).click();
  results.actualTaskButton=await page.evaluate(()=>({task:(document.querySelector('[aria-label="Writing response"]') as HTMLTextAreaElement)?.dataset['taskId'],text:(document.querySelector('[aria-label="Writing response"]') as HTMLTextAreaElement)?.value,focused:document.activeElement?.tagName,commits:(window as any).audit.commits}));
  await reset();
  await page.getByRole('textbox',{name:'Writing response',exact:true}).fill('task one revised');
  await page.evaluate(()=>{(window as any).audit.navigate('task2');});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Writing response"]')?.getAttribute('data-task-id')==='task2');
  await page.getByRole('textbox',{name:'Objective probe'}).click();
  results.focusedTaskChange=await page.evaluate(()=>({task:(document.querySelector('[aria-label="Writing response"]') as HTMLTextAreaElement)?.dataset['taskId'],text:(document.querySelector('[aria-label="Writing response"]') as HTMLTextAreaElement)?.value,commits:(window as any).audit.commits,latest:(window as any).audit.latest}));
  await reset();
  await page.evaluate(()=>{const input=document.querySelector('[aria-label="Objective probe"]') as HTMLInputElement; input.focus();input.value='base native only';input.dispatchEvent(new Event('input',{bubbles:true}));(window as any).audit.bump();});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Objective probe"]')?.getAttribute('data-n')==='1');
  await page.getByRole('textbox',{name:'Writing response',exact:true}).click();
  results.injectedMissingReactChange=await page.evaluate(()=>({text:(document.querySelector('[aria-label="Objective probe"]') as HTMLInputElement)?.value,state:(window as any).audit.objective}));
  console.log(JSON.stringify({...results,errors},null,2));
 } finally {await browser.close();}
}
