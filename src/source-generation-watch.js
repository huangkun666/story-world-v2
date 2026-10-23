// Detect demonstrable long periodic generation inside one unfinished JSON string.
// It never edits output. Caller preserves the raw partial stream and marks the attempt failed.
export function createSourceGenerationWatch(source) {
 let offset=0,pending='',content='',inside=false,escape=false,value='',checked=0,failure=null;
 const input=String(source);
 function consume(text){
  content+=text;
  for(const c of text){
   if(!inside){if(c==='"'){inside=true;value='';checked=0;escape=false;}continue;}
   if(escape){value+=c;escape=false;continue;}
   if(c==='\\'){value+=c;escape=true;continue;}
   if(c==='"'){inside=false;value='';continue;}
   value+=c;
   if(value.length<4096||value.length-checked<512)continue;
   checked=value.length;const tail=value.slice(-4096);
   for(let period=2;period<=128;period++){
    let same=0;for(let i=period;i<tail.length;i++)if(tail[i]===tail[i-period])same++;
    if(same/(tail.length-period)<.95)continue;
    if(input.includes(tail))break;
    failure={type:'generation-loop',message:'模型在同一字段持续重复生成，原文不存在该连续重复片段；本次失败并保留原流'};
    return;
   }
  }
 }
 return {
  update(wire){
   if(failure)return failure;
   const current=String(wire);if(current.length<offset){offset=0;pending='';}
   pending+=current.slice(offset);offset=current.length;
   let match;
   while((match=/\r?\n\r?\n/.exec(pending))){
    const event=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);
    const raw=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
    if(!raw||raw==='[DONE]')continue;
    let data;try{data=JSON.parse(raw)}catch{continue;}
    for(const choice of data.choices??[])if((choice.index??0)===0&&typeof choice.delta?.content==='string')consume(choice.delta.content);
    if(failure)return failure;
   }
   return null;
  },
  get text(){return content;},get failure(){return failure;}
 };
}
