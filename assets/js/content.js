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
    $('goodsSnapshot').textContent = `核验于 ${official.checkedAt} · 日元含税价`;
    $('goodsNotice').textContent = official.productNotice;
    const money = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
    official.products.forEach((product) => {
      const article = make('article', undefined, 'goods-card');
      article.dataset.status = product.status;
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
      body.append(meta, title, foot);
      article.append(imageLink, body);
      $('goodsGrid').append(article);
    });
    document.querySelectorAll('[data-goods-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-goods-filter]').forEach((item) => {
          item.classList.toggle('is-active', item === button);
          item.setAttribute('aria-pressed', String(item === button));
        });
        let shown = 0;
        $('goodsGrid').querySelectorAll('.goods-card').forEach((card) => {
          card.hidden = button.dataset.goodsFilter !== 'all' && button.dataset.goodsFilter !== card.dataset.status;
          if (!card.hidden) shown++;
        });
        $('goodsEmpty').hidden = shown !== 0;
      });
    });
  } else {
    $('goodsNotice').textContent = '商品资料暂时未能加载，请前往官方爱音专区查看。';
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
    $('wikiAttribution').append(
      document.createTextNode(`设定与社区荣誉摘编自萌娘百科《千早爱音》（修订版 ${wiki.revision}，${wiki.checkedAt} 核验），由本站归纳改写；相关摘编文本依 `),
      link('CC BY-NC-SA 4.0', wiki.licenseUrl), document.createTextNode(' 共享。'),
      link('原文', wiki.source), document.createTextNode(' · '), link('固定版本', wiki.revisionUrl), document.createTextNode(' · '), link('贡献者', wiki.historyUrl)
    );
  } else {
    $('wikiSummary').textContent = '百科摘编暂时未能加载，请前往萌娘百科阅读原文。';
  }
})();
