/* 已核验的官方资料、商品快照和百科摘编。全程本地渲染，不在访客浏览器抓取第三方站点。 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const link = (text, href) => {
    const node = make('a', text);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  };
  // 国内平台没有与武士道商店一一对应的官方商品页，因此给出按商品名检索的入口，
  // 由访客在平台内自行确认版本、卖家与价格；本站不代购、不结算。
  const marketLinks = (product) => {
    const keyword = product.marketKeyword || product.name;
    const row = make('div', undefined, 'goods-market');
    const taobao = link('淘宝搜同款', `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`);
    taobao.className = 'goods-market-link';
    taobao.title = `在淘宝搜索「${keyword}」`;
    const mall = link('会员购搜同款', `https://mall.bilibili.com/neul-next/index.html?page=flow_searchResult&keyword=${encodeURIComponent(keyword)}`);
    mall.className = 'goods-market-link';
    mall.title = `在 bilibili 会员购搜索「${keyword}」`;
    row.append(taobao, mall);
    return row;
  };

  const official = window.ANON_OFFICIAL;
  if (official) {
    $('officialSummary').textContent = official.profile.summary;
    $('officialProfileLink').href = official.profile.artistSource || official.profile.source;
    $('officialCheckedAt').textContent = official.checkedAt;
    // 主资料卡已有姓名、乐队等信息；补充官网中的日常喜好与班级。
    official.profile.details.filter((detail) => /班级|食物|兴趣/.test(detail.label)).forEach((detail) => {
      const item = make('div');
      item.append(make('dt', detail.label), make('dd', detail.value));
      $('officialDetails').append(item);
    });
    const money = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
    const productNodes = official.products.map((product, order) => {
      const article = make('article', undefined, 'goods-card');
      article.dataset.status = product.status;
      article.dataset.category = product.category;
      article.dataset.price = String(product.price);
      const imageLink = link('', product.url);
      imageLink.className = 'goods-image-link';
      imageLink.setAttribute('aria-label', `在官方商店查看：${product.name}`);
      const image = make('img');
      image.src = product.image;
      image.alt = product.name;
      image.width = 600;
      image.height = 600;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        image.hidden = true;
        imageLink.append(make('span', '图片暂不可用，前往官方商店查看', 'image-unavailable'));
      }, { once: true });
      imageLink.append(image);
      const body = make('div', undefined, 'goods-body');
      const meta = make('div', undefined, 'goods-meta');
      meta.append(make('span', product.category), make('span', product.statusLabel, `goods-status ${product.status}`));
      const title = make('h3');
      title.append(link(product.name, product.url));
      const foot = make('div', undefined, 'goods-foot');
      const price = make('p', undefined, 'goods-price');
      price.append(make('strong', money.format(product.price)), make('small', ' JPY · 含税'));
      const buy = link(product.status === 'preorder' ? '查看官方预售' : '前往官方商店', product.url);
      buy.className = 'goods-buy';
      foot.append(price, buy);
      body.append(meta, title, foot, marketLinks(product));
      article.append(imageLink, body);
      $('goodsGrid').append(article);
      return { article, product, order };
    });
    const statusButtons = [...document.querySelectorAll('[data-goods-filter]')];
    const category = $('goodsCategory');
    const sort = $('goodsSort');
    let statusFilter = 'all';
    if (category) {
      [...new Set(official.products.map((product) => product.category))].forEach((name) => {
        const option = make('option', name);
        option.value = name;
        category.append(option);
      });
    }
    const filterGoods = () => {
      const ordered = productNodes.slice().sort((a, b) => {
        if (sort?.value === 'price-asc') return a.product.price - b.product.price || a.order - b.order;
        if (sort?.value === 'price-desc') return b.product.price - a.product.price || a.order - b.order;
        return a.order - b.order;
      });
      let shown = 0;
      ordered.forEach(({ article, product }) => {
        article.hidden = (statusFilter !== 'all' && product.status !== statusFilter) ||
          (!!category && category.value !== 'all' && product.category !== category.value);
        if (!article.hidden) shown++;
        $('goodsGrid').append(article);
      });
      statusButtons.forEach((button) => {
        const active = button.dataset.goodsFilter === statusFilter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      $('goodsEmpty').hidden = shown !== 0;
      if ($('goodsCount')) $('goodsCount').textContent = `显示 ${shown} / ${productNodes.length} 件`;
    };
    statusButtons.forEach((button) => {
      button.addEventListener('click', () => {
        statusFilter = button.dataset.goodsFilter;
        filterGoods();
      });
    });
    category?.addEventListener('change', filterGoods);
    sort?.addEventListener('change', filterGoods);
    $('goodsReset')?.addEventListener('click', () => {
      statusFilter = 'all';
      if (category) category.value = 'all';
      if (sort) sort.value = 'featured';
      filterGoods();
      statusButtons[0]?.focus();
    });
    filterGoods();
  }

  const wiki = window.ANON_WIKI;
  if (wiki) {
    $('wikiSummary').textContent = wiki.summary;
    wiki.traits.forEach((trait, index) => {
      const article = make('article');
      article.append(make('span', `0${index + 1}`, 'wiki-number'), make('h3', trait.title), make('p', trait.text));
      $('wikiTraits').append(article);
    });
    wiki.honors.slice().reverse().forEach((honor) => {
      const item = make('li');
      const body = make('div');
      body.append(make('h4', honor.event), make('p', honor.result));
      const reference = link(honor.verification === '主站条目记载' ? '百科记载' : '赛事出处', honor.source);
      reference.className = 'honor-source';
      item.append(make('span', honor.year, 'honor-year'), body, reference);
      $('honorsList').append(item);
    });
    (wiki.posters || []).forEach((poster) => {
      const figure = make('figure', undefined, 'moe-poster reveal');
      if (poster.art) figure.style.setProperty('--poster-art', `url("${poster.art}")`);
      const frame = make('div', undefined, 'moe-poster-frame');
      const kicker = make('span', poster.year, 'moe-poster-year');
      const event = make('strong', poster.event, 'moe-poster-event');
      const art = make('div', undefined, 'moe-poster-art');
      art.setAttribute('aria-hidden', 'true');
      const badge = make('span', poster.result, 'moe-poster-badge');
      const name = make('span', '千早 愛音', 'moe-poster-name');
      frame.append(kicker, event, art, badge, name);
      const caption = make('figcaption');
      caption.append(make('span', poster.kicker, 'moe-poster-kicker'), make('p', poster.caption));
      const reference = link(poster.sourceLabel, poster.source);
      reference.className = 'moe-poster-source';
      caption.append(reference);
      figure.append(frame, caption);
      document.getElementById('moePosters').append(figure);
    });
  } else {
    $('wikiSummary').textContent = '百科摘编暂时未能加载，请前往萌娘百科阅读原文。';
  }
})();
