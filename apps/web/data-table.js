(()=>{
  const states=new Map();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=value=>value==null?'':String(value);
  const valueOf=(row,column)=>column.value?column.value(row):row?.[column.key];
  const sortValue=(row,column)=>column.sortValue?column.sortValue(row):valueOf(row,column);
  const compare=(a,b)=>{
    if(a==null&&b==null)return 0;if(a==null)return-1;if(b==null)return 1;
    if(typeof a==='number'&&typeof b==='number')return a-b;
    const ad=a instanceof Date?a.getTime():Date.parse(a);const bd=b instanceof Date?b.getTime():Date.parse(b);
    if(!Number.isNaN(ad)&&!Number.isNaN(bd)&&/[T:-]/.test(String(a))&&/[T:-]/.test(String(b)))return ad-bd;
    return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  };
  function initial(id,options){
    const existing=states.get(id);if(existing)return existing;
    const state={query:'',sortKey:options.defaultSort?.key??'',sortDir:options.defaultSort?.dir??'asc',page:1,pageSize:options.pageSize??25,filters:{}};
    states.set(id,state);return state;
  }
  function mount(container,options){
    if(!container)throw new Error('DataTable container required');
    const id=options.id||container.id||`table-${Math.random().toString(36).slice(2)}`;const state=initial(id,options);
    const columns=options.columns??[],filters=options.filters??[],rows=Array.isArray(options.rows)?options.rows:[];
    const searchable=columns.filter(column=>column.search!==false);
    const normalized=rows.map((row,index)=>({row,index,key:String(options.rowKey?options.rowKey(row):row?.id??index)}));
    const filtered=normalized.filter(entry=>{
      const q=state.query.trim().toLowerCase();
      if(q&&!searchable.some(column=>text(column.searchValue?column.searchValue(entry.row):valueOf(entry.row,column)).toLowerCase().includes(q)))return false;
      for(const filter of filters){const selected=state.filters[filter.key];if(!selected)continue;const actual=filter.value?filter.value(entry.row):entry.row?.[filter.key];if(String(actual??'')!==selected)return false;}
      return true;
    });
    const sortColumn=columns.find(column=>column.key===state.sortKey&&column.sortable!==false);
    if(sortColumn)filtered.sort((a,b)=>compare(sortValue(a.row,sortColumn),sortValue(b.row,sortColumn))*(state.sortDir==='desc'?-1:1));
    const pageCount=Math.max(1,Math.ceil(filtered.length/state.pageSize));if(state.page>pageCount)state.page=pageCount;if(state.page<1)state.page=1;
    const start=(state.page-1)*state.pageSize,paged=filtered.slice(start,start+state.pageSize);
    const filterMarkup=filters.map(filter=>{
      const values=filter.options??[...new Set(rows.map(row=>filter.value?filter.value(row):row?.[filter.key]).filter(value=>value!==undefined&&value!==null&&value!==''))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
      return `<label class="dt-filter"><span>${esc(filter.label??filter.key)}</span><select data-dt-filter="${esc(filter.key)}"><option value="">All</option>${values.map(value=>`<option value="${esc(value)}" ${String(value)===String(state.filters[filter.key]??'')?'selected':''}>${esc(filter.format?filter.format(value):value)}</option>`).join('')}</select></label>`;
    }).join('');
    const pageSizes=options.pageSizes??[10,25,50,100];
    const head=columns.map(column=>{
      const sortable=column.sortable!==false;const active=state.sortKey===column.key;const arrow=active?(state.sortDir==='asc'?'↑':'↓'):'';
      return `<th data-priority="${esc(column.priority??'normal')}">${sortable?`<button type="button" class="dt-sort" data-dt-sort="${esc(column.key)}">${esc(column.label??column.key)} <span>${arrow}</span></button>`:esc(column.label??column.key)}</th>`;
    }).join('');
    const body=paged.length?paged.map(entry=>`<tr data-dt-row="${esc(entry.key)}">${columns.map(column=>`<td data-label="${esc(column.label??column.key)}" data-priority="${esc(column.priority??'normal')}">${column.render?column.render(entry.row,entry.index):esc(valueOf(entry.row,column))}</td>`).join('')}</tr>`).join(''):`<tr><td class="dt-empty" colspan="${Math.max(1,columns.length)}">${esc(options.emptyText??'No data')}</td></tr>`;
    container.classList.add('data-table-host');
    container.innerHTML=`<div class="dt-toolbar"><label class="dt-search"><span class="sr-only">Search</span><input type="search" data-dt-search placeholder="${esc(options.searchPlaceholder??'Search…')}" value="${esc(state.query)}"></label><div class="dt-filters">${filterMarkup}</div>${options.toolbarHtml??''}<label class="dt-size"><span>Rows</span><select data-dt-size>${pageSizes.map(size=>`<option value="${size}" ${Number(size)===Number(state.pageSize)?'selected':''}>${size}</option>`).join('')}</select></label></div><div class="dt-scroll"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><div class="dt-footer"><span>${filtered.length?`${start+1}–${Math.min(start+state.pageSize,filtered.length)} of ${filtered.length}`:'0 rows'}</span><div class="dt-pages"><button type="button" data-dt-page="first" ${state.page<=1?'disabled':''}>«</button><button type="button" data-dt-page="prev" ${state.page<=1?'disabled':''}>‹</button><span>Page ${state.page} / ${pageCount}</span><button type="button" data-dt-page="next" ${state.page>=pageCount?'disabled':''}>›</button><button type="button" data-dt-page="last" ${state.page>=pageCount?'disabled':''}>»</button></div></div>`;
    const remount=()=>mount(container,options);
    container.querySelector('[data-dt-search]')?.addEventListener('input',event=>{state.query=event.target.value;state.page=1;remount();});
    for(const select of container.querySelectorAll('[data-dt-filter]'))select.addEventListener('change',event=>{state.filters[select.dataset.dtFilter]=event.target.value;state.page=1;remount();});
    container.querySelector('[data-dt-size]')?.addEventListener('change',event=>{state.pageSize=Math.max(1,Number(event.target.value)||25);state.page=1;remount();});
    for(const button of container.querySelectorAll('[data-dt-sort]'))button.addEventListener('click',()=>{const key=button.dataset.dtSort;if(state.sortKey===key)state.sortDir=state.sortDir==='asc'?'desc':'asc';else{state.sortKey=key;state.sortDir='asc';}state.page=1;remount();});
    for(const button of container.querySelectorAll('[data-dt-page]'))button.addEventListener('click',()=>{const action=button.dataset.dtPage;if(action==='first')state.page=1;if(action==='prev')state.page=Math.max(1,state.page-1);if(action==='next')state.page=Math.min(pageCount,state.page+1);if(action==='last')state.page=pageCount;remount();});
    if(options.onAction)container.onclick=event=>{const actionEl=event.target.closest('[data-table-action]');if(!actionEl)return;const tr=actionEl.closest('[data-dt-row]');const entry=normalized.find(item=>item.key===tr?.dataset.dtRow);if(entry)options.onAction(actionEl.dataset.tableAction,entry.row,event,actionEl);};
    return{state,filtered:filtered.map(entry=>entry.row),pageRows:paged.map(entry=>entry.row),refresh:remount};
  }
  window.AevraDataTable={mount,reset(id){states.delete(id);},escape:esc};
})();
