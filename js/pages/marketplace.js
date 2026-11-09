const productCard = (p) => {
  const imgSrc = p.image ? NV.url(p.image) : '';
  const stateBadge = p.state ? `<span class="badge" style="font-size:11px;background:rgba(11,143,62,0.1);color:var(--green-dark);border-radius:10px;padding:2px 8px">${NV.esc(p.state)}</span>` : '';
  const listedDate = p.created_at != null && Number.isFinite(Number(p.created_at)) ? new Date(Number(p.created_at)).toLocaleDateString() : '';
  return `<article class="card product-card" style="display:flex;flex-direction:column;border-radius:12px;overflow:hidden">
    <div class="pic" data-image-query="${NV.esc(`${p.name} ${p.seller} Nigeria`)}" data-image-fallback="Nigerian food" style="position:relative;background:#f0f2f0">
      ${imgSrc ? `<img src="${imgSrc}" alt="${NV.esc(p.name)}" style="width:100%;height:100%;object-fit:cover">` : ''}
      <a href="${NV.router.productUrl(p.id)}" class="pic-link" aria-label="${NV.esc(p.name)}"></a>
      <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
    </div>
    <div class="body" style="padding:14px;display:flex;flex-direction:column;flex:1">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px">
        <h3 style="font-size:15px;margin:0;font-weight:600"><a href="${NV.router.productUrl(p.id)}" style="color:inherit;text-decoration:none">${NV.esc(p.name)}</a></h3>
        ${stateBadge}
      </div>
      <p class="muted" style="font-size:12px;margin:2px 0 10px">Sold by <b>${NV.esc(p.seller)}</b></p>
      <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;padding-top:8px">
        <p class="price" style="font-size:16px;font-weight:700;color:var(--green-dark);margin:0">${NV.money(p.price)}</p>
        <button class="btn btn-primary btn-sm" data-add="${NV.esc(p.id)}" type="button" style="display:inline-flex;align-items:center;gap:6px">
          ${NV.icon('cart')} Add
        </button>
      </div>
      <small class="muted" style="font-size:11px;margin-top:8px">Seller-listed${listedDate ? ` · ${NV.esc(listedDate)}` : ''} · Confirm price with seller</small>
    </div>
  </article>`;
};

NV.pages.marketplace = async function () {
  const box = NV.$('#market');
  const searchInput = NV.$('#market-search');
  const catFilter = NV.$('#market-category-filter');
  const stateFilter = NV.$('#market-state-filter');
  const cartBadge = NV.$('#cart-count-badge');

  function updateCartBadge() {
    if (cartBadge) {
      cartBadge.textContent = NV.services.products.count();
    }
  }
  updateCartBadge();

  // Populate state dropdown
  if (stateFilter && window.NV_STATES) {
    stateFilter.innerHTML = '<option value="all">All Nigerian States</option>' +
      window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}">${NV.esc(s.name)}</option>`).join('');
  }

  async function loadFilteredProducts() {
    const params = {
      search: searchInput ? searchInput.value.trim() : '',
      category: catFilter ? catFilter.value : 'all',
      state: stateFilter ? stateFilter.value : 'all'
    };
    box.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">Loading products from Nigerian creators…</p>';
    const products = await NV.services.products.list(params);
    if (!products.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1;text-align:center;padding:40px"><h3>No products found</h3><p class="muted">Try adjusting your search terms or filters.</p></div>';
      return;
    }
    box.innerHTML = products.map(productCard).join('');
    if (NV.services.images) NV.services.images.scan(box);
  }

  if (searchInput) searchInput.addEventListener('input', NV.debounce(loadFilteredProducts, 300));
  if (catFilter) catFilter.addEventListener('change', loadFilteredProducts);
  if (stateFilter) stateFilter.addEventListener('change', loadFilteredProducts);

  await loadFilteredProducts();

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (b) {
      const pid = b.dataset.add;
      NV.services.products.add(pid);
      updateCartBadge();
      NV.toast('Added to cart', 'success');
    }
  });

  // Sell Dialog
  const sellBtn = NV.$('#open-sell-modal');
  const sellDialog = NV.$('#sell-dialog');
  const closeSellBtn = NV.$('#close-sell-dialog');
  const cancelSellBtn = NV.$('#cancel-sell-btn');
  const sellForm = NV.$('#sell-product-form');

  if (sellBtn && sellDialog) {
    const prodStateSelect = NV.$('#prod-state');
    if (prodStateSelect && window.NV_STATES) {
      prodStateSelect.innerHTML = window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}">${NV.esc(s.name)}</option>`).join('');
    }

    sellBtn.addEventListener('click', async () => {
      const user = await NV.services.auth.getUser();
      if (!user) {
        NV.router.go('login.html?next=marketplace.html');
        return;
      }
      sellDialog.showModal();
    });

    const closeDialog = () => sellDialog.close();
    if (closeSellBtn) closeSellBtn.addEventListener('click', closeDialog);
    if (cancelSellBtn) cancelSellBtn.addEventListener('click', closeDialog);

    if (sellForm) {
      sellForm.addEventListener('submit', async e => {
        e.preventDefault();
        const submitBtn = NV.$('#submit-prod-btn');
        if (submitBtn) submitBtn.disabled = true;

        try {
          const user = await NV.services.auth.getUser();
          const name = sellForm.name.value.trim();
          const price = Number.parseInt(sellForm.price.value, 10);
          const category = sellForm.category.value;
          const state = sellForm.state.value;
          const stock = Number.parseInt(sellForm.stock.value, 10) || 20;
          const description = sellForm.description.value.trim();

          let imageUrl = 'assets/images/trend-culture.jpg';
          const file = sellForm.image.files[0];
          if (file) {
            NV.toast('Uploading product photo...', 'info');
            imageUrl = await NV.services.uploads.upload(file, 'products');
          }

          await NV.services.products.create({
            name,
            price,
            category,
            state,
            stock,
            description,
            image: imageUrl,
            seller: user?.username || 'Verified Seller'
          });

          sellForm.reset();
          closeDialog();
          NV.toast('Product listed on Marketplace!', 'success');
          await loadFilteredProducts();
        } catch (err) {
          NV.toast(err.message || 'Could not list product. Please try again.', 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }
};

NV.pages.product = async function () {
  const p = await NV.services.products.get(NV.param('id') || 1);
  if (!p) {
    NV.$('#product').innerHTML = '<p class="empty">Product not found. Browse the <a class="text-link" href="marketplace.html">marketplace</a>.</p>';
    return;
  }
  document.title = p.name + ' · NaijaVibe';
  const imgSrc = p.image ? NV.url(p.image) : '';
  NV.$('#product').innerHTML = `
    <div class="big" data-image-query="${NV.esc(`${p.name} ${p.seller} Nigeria`)}" data-image-fallback="Nigerian food" style="position:relative;background:#f0f2f0;border-radius:12px;overflow:hidden">
      ${imgSrc ? `<img src="${imgSrc}" alt="${NV.esc(p.name)}" style="width:100%;height:100%;object-fit:cover">` : ''}
      <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:center">
      <span class="badge" style="display:inline-block;width:max-content;font-size:12px;background:rgba(11,143,62,0.1);color:var(--green-dark);border-radius:12px;padding:3px 10px;margin-bottom:8px">
        📍 ${NV.esc(p.state || 'Nigeria')} · ${NV.esc(p.category || 'Marketplace')}
      </span>
      <h1 style="font-size:26px;margin:4px 0">${NV.esc(p.name)}</h1>
      <p class="muted" style="margin:4px 0 14px">Sold by <b>${NV.esc(p.seller)}</b></p>
      <p class="price" style="font-size:28px;font-weight:700;color:var(--green-dark);margin:10px 0">${NV.money(p.price)}</p>
      <p class="muted" style="font-size:12px;margin:0 0 12px">Seller-listed price${p.created_at != null && Number.isFinite(Number(p.created_at)) ? ` · Listed ${NV.esc(new Date(Number(p.created_at)).toLocaleDateString())}` : ''}. Confirm availability and price with the seller before ordering; this is not an official market-price index.</p>
      <p style="line-height:1.6;margin:12px 0">${NV.esc(p.description || 'Authentic Nigerian creation. Made and sold with pride by verified local creators.')}</p>
      <p class="muted" style="font-size:13px;margin:4px 0 18px">Stock available: <b>${p.stock || 25} units</b> · Delivery available across Nigeria</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="add" style="padding:10px 22px">${NV.icon('cart')} Add to cart</button>
        <button class="btn btn-outline" id="buy-now" style="padding:10px 22px">Buy now</button>
        <a class="btn btn-outline" href="cart.html">View cart</a>
      </div>
    </div>`;

  if (NV.services.images) NV.services.images.scan(NV.$('#product'));

  NV.$('#add').addEventListener('click', () => {
    NV.services.products.add(p.id);
    NV.toast('Added to cart', 'success');
  });

  NV.$('#buy-now').addEventListener('click', () => {
    NV.services.products.add(p.id);
    NV.router.go('products/cart.html');
  });
};

NV.pages.cart = async function () {
  const all = await NV.services.products.list();
  const box = NV.$('#cart');
  const totalEl = NV.$('#total');
  const checkoutBtn = NV.$('#checkout');
  const checkoutPanel = NV.$('#checkout-panel');
  const successPanel = NV.$('#order-success-panel');
  const clearBtn = NV.$('#clear-cart-btn');

  function renderCart() {
    const cartItems = NV.services.products.cart();
    if (!cartItems.length) {
      box.innerHTML = '<p class="empty" style="padding:30px;text-align:center">Your cart is empty. Explore authentic items in our <a class="text-link" href="../marketplace.html">Marketplace</a>.</p>';
      if (totalEl) totalEl.textContent = NV.money(0);
      if (checkoutBtn) checkoutBtn.disabled = true;
      if (checkoutPanel) checkoutPanel.style.display = 'none';
      return;
    }
    if (checkoutBtn) checkoutBtn.disabled = false;

    let grandTotal = 0;
    box.innerHTML = cartItems.map(item => {
      const p = all.find(x => String(x.id) === String(item.id)) || { name: 'Nigerian Product', price: 5000, image: 'assets/images/trend-food.jpg' };
      const subtotal = p.price * item.qty;
      grandTotal += subtotal;
      return `<div class="cart-row" style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--border, #eee)">
        <img src="${NV.url(p.image || 'assets/images/trend-food.jpg')}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px">
        <div style="flex:1">
          <b style="font-size:15px">${NV.esc(p.name)}</b><br>
          <span style="color:var(--green-dark);font-weight:600">${NV.money(p.price)}</span>
        </div>
        <div class="qty" style="display:flex;align-items:center;gap:8px">
          <button data-q="${item.id}:${item.qty - 1}" aria-label="Decrease" class="btn btn-outline btn-sm" style="padding:2px 8px;font-weight:700">−</button>
          <span style="min-width:24px;text-align:center;font-weight:600">${item.qty}</span>
          <button data-q="${item.id}:${item.qty + 1}" aria-label="Increase" class="btn btn-outline btn-sm" style="padding:2px 8px;font-weight:700">+</button>
        </div>
        <div style="min-width:80px;text-align:right;font-weight:700">
          ${NV.money(subtotal)}
        </div>
      </div>`;
    }).join('');

    if (totalEl) totalEl.textContent = NV.money(grandTotal);
  }

  renderCart();

  box.addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) {
      const [id, q] = b.dataset.q.split(':');
      NV.services.products.setQty(id, Number(q));
      renderCart();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      NV.services.products.clearCart();
      renderCart();
      NV.toast('Cart cleared', 'info');
    });
  }

  // Populate delivery states
  const stateSelect = NV.$('#c-state');
  if (stateSelect && window.NV_STATES) {
    stateSelect.innerHTML = window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}">${NV.esc(s.name)}</option>`).join('');
  }

  // Pre-fill user data if authenticated
  const currentUser = await NV.services.auth.getUser();
  if (currentUser) {
    const profile = await NV.services.profile.get().catch(() => ({}));
    if (NV.$('#c-name') && profile.display_name) NV.$('#c-name').value = profile.display_name;
    if (NV.$('#c-email') && currentUser.email) NV.$('#c-email').value = currentUser.email;
    if (NV.$('#c-phone') && profile.phone) NV.$('#c-phone').value = profile.phone;
    if (NV.$('#c-state') && profile.state) NV.$('#c-state').value = profile.state;
  }

  // Show checkout panel
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      if (!NV.services.products.cart().length) return;
      checkoutPanel.style.display = 'block';
      checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const cancelCheckoutBtn = NV.$('#cancel-checkout-btn');
  if (cancelCheckoutBtn) {
    cancelCheckoutBtn.addEventListener('click', () => {
      checkoutPanel.style.display = 'none';
    });
  }

  // Toggle bank transfer notice
  const payRadios = document.querySelectorAll('input[name="payment_method"]');
  const transferInfo = NV.$('#bank-transfer-info');
  payRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (transferInfo) {
        transferInfo.style.display = radio.value === 'Bank Transfer' ? 'block' : 'none';
      }
    });
  });

  // Handle Checkout submission
  const checkoutForm = NV.$('#checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async e => {
      e.preventDefault();
      const placeBtn = NV.$('#place-order-btn');
      if (placeBtn) placeBtn.disabled = true;

      try {
        const cartItems = NV.services.products.cart();
        const items = cartItems.map(item => {
          const p = all.find(x => String(x.id) === String(item.id)) || { name: 'Product', price: 5000 };
          return { id: item.id, name: p.name, price: p.price, qty: item.qty };
        });

        const selectedPayment = document.querySelector('input[name="payment_method"]:checked')?.value || 'Pay on Delivery';

        const order = await NV.services.products.checkout({
          customer_name: checkoutForm.name.value.trim(),
          customer_email: checkoutForm.email.value.trim(),
          customer_phone: checkoutForm.phone.value.trim(),
          delivery_address: checkoutForm.address.value.trim(),
          state: checkoutForm.state.value,
          payment_method: selectedPayment,
          items
        });

        // Show success panel
        checkoutPanel.style.display = 'none';
        renderCart();

        if (successPanel) {
          NV.$('#success-order-num').textContent = order.order_number;
          NV.$('#success-order-total').textContent = NV.money(order.total_amount);
          NV.$('#success-order-payment').textContent = order.payment_method;
          NV.$('#success-order-address').textContent = `${order.delivery_address}, ${order.state} State`;
          successPanel.style.display = 'block';
          successPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        NV.toast('Order placed successfully!', 'success');
      } catch (err) {
        NV.toast(err.message || 'Could not complete order. Please try again.', 'error');
      } finally {
        if (placeBtn) placeBtn.disabled = false;
      }
    });
  }
};

NV.pages.businesses = async function () {
  const bizBox = NV.$('#biz');
  const list = await NV.services.businesses.list();
  bizBox.innerHTML = list.map(NV.businessCard).join('');
};

NV.pages.business = async function () {
  const b = await NV.services.businesses.get(NV.param('id') || 1);
  if (!b) {
    NV.$('#business').innerHTML = '<p class="empty">Business not found. Browse the <a class="text-link" href="index.html">Business Directory</a>.</p>';
    return;
  }
  document.title = b.name + ' · NaijaVibe';

  const productsHtml = (b.products && b.products.length)
    ? `<div style="margin-top:30px">
        <h2 style="font-size:20px;margin-bottom:14px">Products by ${NV.esc(b.name)}</h2>
        <div class="market-grid">${b.products.map(productCard).join('')}</div>
       </div>`
    : '';

  NV.$('#business').innerHTML = `
    <div class="product-page" style="padding:0">
      <div class="big" data-image-query="${NV.esc(`${b.name} ${b.state} Nigeria`)}" data-image-fallback="Nigerian business">
        <a class="photo-credit" data-photo-credit hidden target="_blank" rel="noopener noreferrer"></a>
      </div>
      <div>
        <span class="badge" style="display:inline-block;font-size:12px;background:rgba(11,143,62,0.1);color:var(--green-dark);border-radius:12px;padding:3px 10px;margin-bottom:8px">
          ${NV.esc(b.cat || 'Business')} · 📍 ${NV.esc(b.state)}
        </span>
        <h1 style="font-size:26px;margin:4px 0">${NV.esc(b.name)}</h1>
        <p class="muted" style="margin:4px 0 12px">★ ${b.rating} Rating · Verified Nigerian Business</p>
        <p style="line-height:1.6;margin:14px 0">${NV.esc(b.description || 'A local Nigerian business on NaijaVibe.')}</p>
        ${b.phone ? `<p style="font-size:14px;margin:6px 0">📞 <b>Contact:</b> ${NV.esc(b.phone)}</p>` : ''}
        ${b.address ? `<p style="font-size:14px;margin:6px 0">📍 <b>Address:</b> ${NV.esc(b.address)}</p>` : ''}
        <div style="margin-top:20px;display:flex;gap:10px">
          <button class="btn btn-primary" id="follow">Follow Business</button>
          <a class="btn btn-outline" href="../contact.html">Send Inquiry</a>
        </div>
      </div>
    </div>
    ${productsHtml}`;

  const f = NV.$('#follow');
  if (f) {
    f.addEventListener('click', async () => {
      const on = await NV.services.follows.toggle('biz-' + b.id);
      f.textContent = on ? 'Following' : 'Follow Business';
    });
  }

  if (NV.services.images) NV.services.images.scan(NV.$('#business'));
};

NV.pages['business-register'] = function () {
  NV.router.requireAuth();
  const f = NV.$('#biz-form');
  NV.validate.bind(f);
  if (NV.$('#state') && window.NV_STATES) {
    NV.$('#state').innerHTML = window.NV_STATES.map(s => `<option value="${NV.esc(s.name)}">${NV.esc(s.name)}</option>`).join('');
  }
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!NV.validate.form(f)) return;
    try {
      await NV.services.businesses.register({
        name: f.elements.name.value.trim(),
        cat: f.cat.value,
        state: f.state.value,
        description: f.description.value.trim()
      });
      NV.toast('Business submitted and listed successfully!', 'success');
      setTimeout(() => NV.router.go('businesses/index.html'), 800);
    } catch (err) {
      NV.toast(err.message || 'Could not register business.', 'error');
    }
  });
};
