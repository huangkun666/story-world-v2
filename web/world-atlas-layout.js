
// Read-only relation geometry. The renderer and collision checks share one footprint.
export const RELATION_CARD=Object.freeze({width:180,height:58,padding:12});
const width=RELATION_CARD.width+RELATION_CARD.padding*2,height=RELATION_CARD.height+RELATION_CARD.padding*2;
const compare=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const overlaps=(a,b)=>Math.abs(a.style.x-b.style.x)<width&&Math.abs(a.style.y-b.style.y)<height;
function disjoint(nodes){for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(overlaps(nodes[i],nodes[j]))return false;return true;}
function grid(nodes,narrow){const columns=Math.min(narrow?2:8,Math.max(1,Math.ceil(Math.sqrt(nodes.length))));return nodes.map((n,i)=>({...n,style:{...n.style,x:(i%columns)*(width+16),y:Math.floor(i/columns)*(height+16)}}));}
function separate(nodes,narrow){
 let result=nodes.map(n=>({...n,style:{...n.style,x:Number.isFinite(n.style?.x)?n.style.x:0,y:Number.isFinite(n.style?.y)?n.style.y:0}}));
 // Every pass visits all pairs; the final check catches overlaps introduced by later moves.
 for(let pass=0;pass<8;pass++){
  let changed=false;
  for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){
   const a=result[i],b=result[j];if(!overlaps(a,b))continue;changed=true;
   const dx=b.style.x-a.style.x,dy=b.style.y-a.style.y,px=width-Math.abs(dx),py=height-Math.abs(dy);
   const axis=px<py?'x':'y',distance=((axis==='x'?px:py)+1)/2,sign=(axis==='x'?dx:dy)<0?-1:1;
   a.style[axis]-=distance*sign;b.style[axis]+=distance*sign;
  }
  if(!changed)return result;
 }
 return disjoint(result)?result:grid(nodes,narrow);
}
function components(nodes,edges){
 const byId=new Map(nodes.map(n=>[n.id,n])),adj=new Map(nodes.map(n=>[n.id,new Set()]));
 for(const edge of edges)if(adj.has(edge.source)&&adj.has(edge.target)){adj.get(edge.source).add(edge.target);adj.get(edge.target).add(edge.source);}
 const seen=new Set(),groups=[];
 for(const n of nodes){if(seen.has(n.id))continue;const ids=[n.id];seen.add(n.id);for(let i=0;i<ids.length;i++)for(const id of adj.get(ids[i]))if(!seen.has(id)){seen.add(id);ids.push(id);}groups.push(ids.map(id=>byId.get(id)).sort(compare));}
 return groups;
}
export function layoutRelationCards(nodes,edges,{focus=false,narrow=false}={}){
 if(!nodes.length)return [];
 const sorted=[...nodes].sort(compare);let arranged;
 if(focus)arranged=separate(sorted,narrow);
 else{
  const targetWidth=Math.min(narrow?2:8,Math.max(1,Math.ceil(Math.sqrt(nodes.length))))*(width+16);
  arranged=[];let x=0,y=0,rowHeight=0;
  for(const group of components(sorted,edges)){
   const cards=separate(group,narrow),minX=Math.min(...cards.map(n=>n.style.x)),minY=Math.min(...cards.map(n=>n.style.y));
   const boxWidth=Math.max(...cards.map(n=>n.style.x))-minX+width,boxHeight=Math.max(...cards.map(n=>n.style.y))-minY+height;
   if(x&&x+boxWidth>targetWidth){x=0;y+=rowHeight+40;rowHeight=0;}
   for(const n of cards)arranged.push({...n,style:{...n.style,x:n.style.x-minX+x+width/2,y:n.style.y-minY+y+height/2}});
   x+=boxWidth+40;rowHeight=Math.max(rowHeight,boxHeight);
  }
  // Component boxes are disjoint; retain a whole-graph postcondition as a final guard.
  if(!disjoint(arranged))arranged=grid(sorted,narrow);
 }
 const byId=new Map(arranged.map(n=>[n.id,n]));return nodes.map(n=>byId.get(n.id));
}
