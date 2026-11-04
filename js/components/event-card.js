(function (NV) {
  NV.eventRow = (e) => `<div class="event-row"><div class="event-date">${e.month}<b>${e.day}</b></div>
    <div><h4>${NV.esc(e.title)}</h4><p>${NV.esc(e.place)}</p><span class="chip chip-${e.chip}">${NV.esc(e.cat)}</span></div></div>`;
  NV.eventCard = (e) => `<article class="card event-card"><div class="event-date">${e.month}<b>${e.day}</b></div>
    <div style="flex:1"><h3 style="font-size:15px">${NV.esc(e.title)}</h3><p class="muted">${NV.icon('pin')} ${NV.esc(e.place)}</p><span class="chip chip-${e.chip}">${NV.esc(e.cat)}</span></div>
    <button class="btn btn-outline btn-sm" data-remind="${e.id}">${NV.icon('bell')}Remind me</button></article>`;
})(window.NV);
