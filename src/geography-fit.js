// 地理资料只使用主资料装好后的余量；包含链整组装入。
export function fitGeography(pack, geography, budget, measure) {
    if (!geography) return [];
    const fits = candidate => measure({...pack, geography:candidate}) <= budget;
    if (fits(geography)) { pack.geography=geography; return []; }
    const allPlaces=geography.places||[], allLinks=geography.links||[];
    const parents=new Map();
    for(const link of allLinks) if(link.type==='within') {
        if(!parents.has(link.from)) parents.set(link.from,[]);
        parents.get(link.from).push(link.to);
    }
    const closure=ids=>{
        const set=new Set(ids), pending=[...ids];
        while(pending.length)for(const parent of parents.get(pending.pop())||[])
            if(!set.has(parent)){set.add(parent);pending.push(parent);}
        return set;
    };
    const related=new Set(geography.relevantPlaceIds||[]);
    const candidate=(ids,edges)=>{
        const places=allPlaces.filter(p=>ids.has(p.id));
        const links=allLinks.filter(l=>l.type==='within' ? ids.has(l.from)&&ids.has(l.to) : edges.has(l));
        const entities=(geography.positions?.entities||[]).filter(r=>r.placeId&&ids.has(r.placeId));
        const events=(geography.positions?.events||[]).filter(r=>r.placeId&&ids.has(r.placeId));
        const positions={entities,events};
        const move=geography.positions?.move;
        if(move&&(!move.placeId||ids.has(move.placeId)))positions.move=move;
        return {version:geography.version,places,links,positions,
            relevantPlaceIds:[...related].filter(id=>ids.has(id)),
            coverage:{loadedPlaces:places.length,omittedPlaces:allPlaces.length-places.length,
                loadedLinks:links.length,omittedLinks:allLinks.length-links.length,
                omittedPositions:(geography.positions?.entities?.length||0)+(geography.positions?.events?.length||0)-entities.length-events.length}};
    };
    let selected=new Set(), selectedEdges=new Set();
    // 计数与最终裁剪痕迹一同量体，不能最后再塞字节。
    pack.trimmed=[...(pack.trimmed||[]),'geography'];
    const tryGroup=(ids,edge=null)=>{
        const next=closure([...selected,...ids]);
        const nextEdges=new Set(selectedEdges);if(edge)nextEdges.add(edge);
        if(fits(candidate(next,nextEdges))){selected=next;selectedEdges=nextEdges;}
    };
    for(const id of related)tryGroup([id]);
    const near=allLinks.filter(l=>l.type!=='within'&&(related.has(l.from)||related.has(l.to)));
    for(const link of near)tryGroup([link.from,link.to],link);
    for(const place of allPlaces)if(!selected.has(place.id))tryGroup([place.id]);
    for(const link of allLinks)if(link.type!=='within'&&!selectedEdges.has(link))tryGroup([link.from,link.to],link);
    pack.geography=candidate(selected,selectedEdges);
    if(measure(pack)>budget&&!pack.trimmed.includes('budgetOverrun'))pack.trimmed.push('budgetOverrun');
    return ['geography'];
}
