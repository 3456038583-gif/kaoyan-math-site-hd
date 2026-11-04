/* 渲染与交互 */
(function () {
  'use strict';

  const appEl = document.getElementById('app');
  const yearsEl = document.getElementById('years');
  const noteEl = document.getElementById('yearnote');
  const modulesEl = document.getElementById('modules');
  const sheetEl = document.getElementById('pdfsheet');
  const frameEl = document.getElementById('pdfFrame');
  const pdfTitleEl = document.getElementById('pdfTitle');
  const pdfOpenEl = document.getElementById('pdfOpen');

  const SUBJ_VIEW = { m1: 1, m2: 2, m3: 3 };
  const LV_CLASS = { '常规': 'e', '中档': 'm', '难题': 'h' };
  // 2021 年起题型改革：10 选择 + 6 填空 + 6 解答，共 22 题
  const groupsFor = year => year >= 2021
    ? [
        { title: '一、选择题', from: 1, to: 10, meta: '10 题 · 每题 5 分 · 共 50 分' },
        { title: '二、填空题', from: 11, to: 16, meta: '6 题 · 每题 5 分 · 共 30 分' },
        { title: '三、解答题', from: 17, to: 22, meta: '6 题 · 共 70 分' }
      ]
    : [
        { title: '一、选择题', from: 1, to: 8, meta: '8 题 · 每题 4 分 · 共 32 分' },
        { title: '二、填空题', from: 9, to: 14, meta: '6 题 · 每题 4 分 · 共 24 分' },
        { title: '三、解答题', from: 15, to: 23, meta: '9 题 · 共 94 分' }
      ];

  /* ── 成绩记录：题型分值、存储与统计 ── */
  // 2021 年改革前：选 8×4、填 6×4、解答 15—19 各 10 分、20—23 各 11 分
  // 2021 年起：选 10×5、填 6×5、解答 17 题 10 分、18—22 各 12 分
  const qKind = (year, n) => {
    if (year >= 2021) return n <= 10 ? 'choice' : n <= 16 ? 'fill' : 'big';
    return n <= 8 ? 'choice' : n <= 14 ? 'fill' : 'big';
  };
  const qMax = (year, n) => {
    if (year >= 2021) return n <= 16 ? 5 : n === 17 ? 10 : 12;
    return n <= 14 ? 4 : n <= 19 ? 10 : 11;
  };
  const paperKey = (year, subject) => `${year}-${subject}`;

  const SCORE_STORE_KEY = 'kaoyanMath.scores.v1';
  const SCORES = {};
  (function loadScores() {
    try {
      const raw = JSON.parse(localStorage.getItem(SCORE_STORE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      for (const [k, rec] of Object.entries(raw)) {
        const m = /^(\d{4})-([123])$/.exec(k);
        if (!m || !rec || typeof rec !== 'object') continue;
        const year = Number(m[1]);
        const subject = Number(m[2]);
        if (!ALL_YEARS.includes(year)) continue;
        const qCount = year >= 2021 ? 22 : 23;
        // touched=false 表示这份卷子的分数只是同题自动同步过来的，用户还没在这里记录过
        const clean = { sel: {}, big: {}, touched: rec.touched !== false };
        if (rec.sel && typeof rec.sel === 'object') {
          for (const [n, v] of Object.entries(rec.sel)) {
            const qn = Number(n);
            if (qn >= 1 && qn <= qCount && qKind(year, qn) !== 'big' && (v === 0 || v === 1)) {
              clean.sel[qn] = v;
            }
          }
        }
        if (rec.big && typeof rec.big === 'object') {
          for (const [n, v] of Object.entries(rec.big)) {
            const qn = Number(n);
            if (qn >= 1 && qn <= qCount && qKind(year, qn) === 'big' && Number.isFinite(v)) {
              clean.big[qn] = Math.min(qMax(year, qn), Math.max(0, Number(v)));
            }
          }
        }
        if (Object.keys(clean.sel).length || Object.keys(clean.big).length) SCORES[k] = clean;
      }
    } catch (e) {
      // 隐私模式或禁用存储时，仅本次会话有效
    }
  })();

  const scoreRec = (year, subject) => SCORES[paperKey(year, subject)] || null;
  // touched 默认 true：用户在这份卷子上直接改分；同题自动同步写入时传 false
  const ensureScoreRec = (year, subject, touched = true) => {
    const k = paperKey(year, subject);
    if (!SCORES[k]) SCORES[k] = { sel: {}, big: {}, touched: touched !== false };
    else if (touched !== false) SCORES[k].touched = true;
    return SCORES[k];
  };
  const pruneScoreRec = (year, subject) => {
    const rec = SCORES[paperKey(year, subject)];
    if (rec && !Object.keys(rec.sel).length && !Object.keys(rec.big).length) {
      delete SCORES[paperKey(year, subject)];
    }
  };
  const saveScores = () => {
    try {
      localStorage.setItem(SCORE_STORE_KEY, JSON.stringify(SCORES));
    } catch (e) {
      // 隐私模式或存储已满时忽略，页面仍可继续使用
    }
    VIEW_CACHE.clear();
  };
  const fmtScore = v => {
    if (!Number.isFinite(v)) return '—';
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  const state = { view: 'm1', year: 2010, level: 'all', keyOnly: false, statsSubject: 1 };
  // 已渲染页面的 DOM 缓存（按视图 + 年份）；成绩改动后由 saveScores 统一清空
  const VIEW_CACHE = new Map();
  const VIEW_CACHE_MAX = 5;

  // 已上线年份由 data.js 的清单给出，不必先把各年数据都载进来
  const liveYears = () => LIVE_YEARS;

  /* ── 错题本（localStorage，file:// 下同样可用） ── */
  const WRONG_KEY = 'kaoyanMath.wrong.v1';
  const wrongKey = (year, subject, n) => `${year}-${subject}-${n}`;
  const loadWrong = () => {
    try {
      const list = JSON.parse(localStorage.getItem(WRONG_KEY) || '[]');
      return new Set(Array.isArray(list) ? list.filter(k => /^\d{4}-[123]-\d+$/.test(k)) : []);
    } catch (e) {
      return new Set();
    }
  };
  const WRONG = loadWrong();
  const saveWrong = () => {
    try {
      localStorage.setItem(WRONG_KEY, JSON.stringify([...WRONG]));
    } catch (e) {
      // 隐私模式或禁用存储时，仅本次会话有效
    }
  };
  const updateWrongBadge = () => {
    const el = document.getElementById('wcount');
    if (!el) return;
    el.textContent = String(WRONG.size);
    el.hidden = WRONG.size === 0;
  };
  // 同一道题可能同时出现在真题页、重点题页和补充题页，统一刷新按钮状态
  const syncWrongBtns = () => {
    document.querySelectorAll('[data-wrong]').forEach(b => {
      const on = WRONG.has(b.dataset.wrong);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '已加入错题本' : '加入错题本';
    });
    updateWrongBadge();
  };

  /* ── 数据工具 ── */
  const getQ = (year, subject, n) => {
    const arr = PAPERS[`${year}-${subject}`];
    return arr ? arr.find(q => q.n === n) : null;
  };

  const levelOf = (year, subject, n) => {
    const d = DIST[year] && DIST[year][subject];
    if (d) {
      if (d.easy.qs.split(',').map(Number).includes(n)) return '常规';
      if (d.mid.qs.split(',').map(Number).includes(n)) return '中档';
      if (d.hard.qs.split(',').map(Number).includes(n)) return '难题';
    }
    const q = getQ(year, subject, n);
    return q ? q.lv : '常规';
  };

  const isKeyQ = (year, subject, n) => {
    const k = KP_KEY[year] && KP_KEY[year][subject];
    return !!(k && k.includes(n));
  };

  const shortSubj = s => SUBJ[s].replace('数学', '数');

  // 把一年的记录折算成各题型 / 各模块的得分；未标记的题按 0 分计
  function computePaperScore(year, subject) {
    const paper = PAPERS[paperKey(year, subject)] || [];
    const rec = scoreRec(year, subject);
    const mk = () => ({ score: 0, max: 0, any: false, set: 0, count: 0, correct: 0 });
    const cats = { choice: mk(), fill: mk(), big: mk(), '高数': mk(), '线代': mk(), '概率': mk() };
    for (const q of paper) {
      const kind = qKind(year, q.n);
      const max = qMax(year, q.n);
      const isBig = kind === 'big';
      const raw = rec ? (isBig ? rec.big[q.n] : rec.sel[q.n]) : undefined;
      const has = raw !== undefined;
      const got = !has ? 0 : isBig ? Math.min(max, Math.max(0, raw)) : (raw ? max : 0);
      for (const key of [kind, q.m]) {
        const c = cats[key];
        if (!c) continue;
        c.max += max;
        c.score += got;
        c.count++;
        if (has) { c.any = true; c.set++; }
        if (!isBig && raw === 1) c.correct++;
      }
    }
    const merge = (a, b) => ({
      score: a.score + b.score,
      max: a.max + b.max,
      any: a.any || b.any,
      set: a.set + b.set,
      count: a.count + b.count,
      correct: a.correct + b.correct
    });
    const sel = merge(cats.choice, cats.fill);
    const total = merge(sel, cats.big);
    const out = Object.assign({}, cats, { sel, total, year, subject });
    for (const key of ['choice', 'fill', 'sel', 'big', 'total', '高数', '线代', '概率']) {
      const c = out[key];
      c.pct = c.max ? c.score / c.max * 100 : null;
      c.complete = c.count > 0 && c.set === c.count;
    }
    out.hasAny = total.any;
    return out;
  }

  // 同一年另一科目里题干完全相同的题（数一/数二/数三经常共用题目）
  function otherSameQuestions(year, subject, q) {
    const stem = String(q.x).trim();
    const out = [];
    const seen = new Set();
    for (const s of [1, 2, 3]) {
      if (s === subject) continue;
      for (const o of (PAPERS[paperKey(year, s)] || [])) {
        if (!!o.o !== !!q.o || String(o.x).trim() !== stem) continue;
        const k = `${s}-${o.n}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ subject: s, q: o });
      }
    }
    return out;
  }

  function sameQuestionHint(year, subject, q) {
    const kind = qKind(year, q.n);
    const parts = otherSameQuestions(year, subject, q).map(o => {
      const rec = scoreRec(year, o.subject);
      const val = rec ? (kind === 'big' ? rec.big[o.q.n] : rec.sel[o.q.n]) : undefined;
      if (val === undefined) return `${shortSubj(o.subject)} ${o.q.n}`;
      if (kind === 'big') return `${shortSubj(o.subject)} ${o.q.n}（${fmtScore(val)} 分）`;
      return `${shortSubj(o.subject)} ${o.q.n}（${val === 1 ? '对' : '错'}）`;
    });
    return parts.length ? ` · 同题 ${parts.join('、')}` : '';
  }

  // 同题成绩始终共用一个值：任何一科改了，其他科目的同一道题跟着改
  function sameQuestionTargets(year, subject, n) {
    const q = getQ(year, subject, n);
    if (!q) return [];
    const isBig = qKind(year, n) === 'big';
    return otherSameQuestions(year, subject, q)
      .filter(o => (qKind(year, o.q.n) === 'big') === isBig)
      .map(o => ({ subject: o.subject, n: o.q.n }));
  }

  // value 为 undefined 表示取消标记 / 清空该题
  function propagateScore(year, subject, n, value, onlyMissing) {
    let changed = 0;
    for (const t of sameQuestionTargets(year, subject, n)) {
      const rec = scoreRec(year, t.subject);
      const isBig = qKind(year, n) === 'big';
      const cur = rec ? (isBig ? rec.big[t.n] : rec.sel[t.n]) : undefined;
      if (cur === value) continue;
      if (onlyMissing && cur !== undefined) continue;
      if (value === undefined) {
        if (cur === undefined) continue;
        if (isBig) delete rec.big[t.n]; else delete rec.sel[t.n];
      } else {
        const target = ensureScoreRec(year, t.subject, false);
        if (isBig) target.big[t.n] = Math.min(qMax(year, t.n), Math.max(0, value));
        else target.sel[t.n] = value;
      }
      pruneScoreRec(year, t.subject);
      changed++;
    }
    return changed;
  }

  // 打开页面时补全旧记录里只在一科记过、另一科还空着的同题
  function reconcileLoadedScores() {
    let changed = 0;
    for (const year of LOADED_YEARS) {
      for (const subject of [1, 2, 3]) {
        const rec = scoreRec(year, subject);
        if (!rec) continue;
        for (const [n, val] of Object.entries(rec.sel)) {
          changed += propagateScore(year, subject, Number(n), val, true);
        }
        for (const [n, val] of Object.entries(rec.big)) {
          changed += propagateScore(year, subject, Number(n), val, true);
        }
      }
    }
    if (changed) saveScores();
    return changed;
  }

  function syncSameScores(year, subject) {
    let count = 0;
    const bySource = { 1: 0, 2: 0, 3: 0 };
    for (const q of (PAPERS[paperKey(year, subject)] || [])) {
      const kind = qKind(year, q.n);
      for (const o of otherSameQuestions(year, subject, q)) {
        const src = scoreRec(year, o.subject);
        if (!src) continue;
        const val = kind === 'big' ? src.big[o.q.n] : src.sel[o.q.n];
        if (val === undefined) continue;
        const rec = ensureScoreRec(year, subject);
        if (kind === 'big') rec.big[q.n] = Math.min(qMax(year, q.n), Math.max(0, val));
        else rec.sel[q.n] = val;
        count++;
        bySource[o.subject]++;
        break; // 数二、数三都有同题时取先找到的一条
      }
    }
    if (count) {
      pruneScoreRec(year, subject);
      saveScores();
    }
    return { count, bySource };
  }

  const paperPath = (year, subject, kind) => `pdfs/${year}/${year}-m${subject}-${kind}.pdf`;
  const reviewPath = year => `pdfs/${year}/${year}-review.pdf`;

  // 试卷排版里 lim/∑ 的上下标写在正下方；定积分、重积分的上下限写在积分号右侧
  const LIMIT_OPS = /\\(lim|limsup|liminf|varlimsup|varliminf|max|min|sup|inf|sum|prod|coprod|bigcup|bigcap)_/g;
  // KaTeX 在 \displaystyle 下会把 \int 的上下限堆到正上/正下（\nolimits 也压不住），
  // 把紧跟在 \displaystyle 后面的积分号换成 textstyle 版本，上下限就回到右上方/右下方
  const DISPLAY_INT = /\\displaystyle\s*\\(int|iint|iiint|oint)(?![A-Za-z])/g;

  // 试卷里的表格（联合分布表等）按原样画出来，改写成 "P{X=…}=…" 罗列会改变题面。
  // 写法：<tbl>X\Y|$0$|$1$|$2$;$0$|$\frac14$|$0$|…</tbl>
  // 行用 ; 分隔、单元格用 | 分隔（\｜、\; 表示字面量）；首行首格写 行变量\列变量，由 CSS 画斜线。
  const TBL_RE = /<tbl>([\s\S]*?)<\/tbl>/gi;
  const esc = c => String(c).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  const buildTable = body => {
    const PIPE = '\u0002', SEMI = '\u0003';
    const rows = body.replace(/\\\|/g, PIPE).replace(/\\;/g, SEMI).split(';')
      .map(r => r.split('|').map(c => c.replace(new RegExp(PIPE, 'g'), '|').replace(new RegExp(SEMI, 'g'), ';')))
      .filter(r => r.some(c => c.trim()));
    if (!rows.length) return '';
    const head = rows[0];
    // 首格写 "行变量\列变量" 画斜线；只写一个变量（如分布律表的 "X"）则画普通表头格，与试卷一致
    const corner = (head[0] || '').split('\\');
    const cornerCell = corner.length > 1
      ? `<td class="corner"><span class="cx">${esc(corner[0] || 'X')}</span><span class="cy">${esc(corner[1] || 'Y')}</span></td>`
      : `<td class="corner plain"><span class="cx">${esc(corner[0] || '')}</span></td>`;
    const html = [`<table class="tbl"><tr>${cornerCell}`];
    for (let i = 1; i < head.length; i++) html.push(`<th>${esc(head[i])}</th>`);
    html.push('</tr>');
    for (let r = 1; r < rows.length; r++) {
      html.push(`<tr><th>${esc(rows[r][0] || '')}</th>`);
      for (let i = 1; i < rows[r].length; i++) html.push(`<td>${esc(rows[r][i] || '')}</td>`);
      html.push('</tr>');
    }
    html.push('</table>');
    return html.join('');
  };

  // 试卷原图（函数图像、区域图等）用 <fig>figs/2015/m1-q1.png</fig> 引用，图片直接从试卷截图
  const FIG_RE = /<fig>([^<]*)<\/fig>/gi;

  // 题干里的 "<" 会被浏览器当成标签开头（如 $I<K$），只保留 <br>/<b>/<tbl>/<fig> 等少量排版标签
  const safe = s => {
    const tags = [];
    return String(s)
      .replace(DISPLAY_INT, '\\displaystyle{\\textstyle\\$1}')
      .replace(LIMIT_OPS, '\\$1\\limits_')
      .replace(FIG_RE, (_, src) => {
        tags.push(`<img class="qfig" src="${src.trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="题图">`);
        return '\u0000' + (tags.length - 1) + '\u0001';
      })
      .replace(TBL_RE, (_, body) => { tags.push(buildTable(body)); return '\u0000' + (tags.length - 1) + '\u0001'; })
      .replace(/<\/?(?:br|b|i|em|strong)\s*\/?>/gi, m => { tags.push(m); return '\u0000' + (tags.length - 1) + '\u0001'; })
      .replace(/</g, '&lt;')
      .replace(/\u0000(\d+)\u0001/g, (_, i) => tags[+i]);
  };

  const stars = st => {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < st ? '★' : '<span class="off">★</span>';
    return `<span class="stars" title="难度 ${st}/5">${s}<span class="num">${st}/5</span></span>`;
  };

  // 整段都是积分/求和这类带上下限的式子时，嵌套的上下限会很小，整体放大一点才接近试卷排版
  const bigOpt = t => !/[一-鿿]/.test(t) && /\\(?:i{1,3}nt|oint|sum|prod|lim)/.test(t);

  /* ── 我的成绩面板 ── */
  const attr = s => esc(s).replace(/"/g, '&quot;');

  function scorePanelHTML(year, subject) {
    const paper = PAPERS[paperKey(year, subject)] || [];
    const rec = scoreRec(year, subject);
    const c = computePaperScore(year, subject);
    const choiceQs = paper.filter(q => qKind(year, q.n) === 'choice');
    const fillQs = paper.filter(q => qKind(year, q.n) === 'fill');
    const bigQs = paper.filter(q => qKind(year, q.n) === 'big');

    const chip = q => {
      const v = rec ? rec.sel[q.n] : undefined;
      const title = `${q.n} 题 · ${q.m} · ${attr(q.t)}${sameQuestionHint(year, subject, q)}`;
      return `<button class="qsbtn${v === 0 ? ' is-wrong' : ''}" type="button" data-score-q="${q.n}" aria-pressed="${v === 1}" title="${title}">${q.n}</button>`;
    };

    const bigRows = bigQs.map(q => {
      const max = qMax(year, q.n);
      const v = rec ? rec.big[q.n] : undefined;
      const copies = otherSameQuestions(year, subject, q).map(o => {
        const src = scoreRec(year, o.subject);
        const sv = src ? src.big[o.q.n] : undefined;
        if (sv === undefined) return '';
        return `<button class="copybtn" type="button" data-copy-big="${o.subject},${o.q.n},${q.n}" title="复制 ${SUBJ[o.subject]}第 ${o.q.n} 题的得分">同题 ${shortSubj(o.subject)} ${o.q.n} · ${fmtScore(sv)} 分</button>`;
      }).join('');
      return `<div class="bigrow">
        <span class="bigq">${q.n}</span>
        <span class="bigmeta"><b>${q.m}</b> · ${max} 分</span>
        <span class="biginput"><input type="number" inputmode="decimal" min="0" max="${max}" step="0.5" placeholder="—" value="${v === undefined ? '' : fmtScore(v)}" data-score-big="${q.n}" aria-label="第 ${q.n} 题得分，满分 ${max} 分"><span class="bigmax">/ ${max}</span></span>
        ${copies}
      </div>`;
    }).join('');

    return `<section class="card scorecard${c.hasAny ? ' has-score' : ''}" data-scorecard data-year="${year}" data-subject="${subject}">
      <div class="scorecard-head">
        <div>
          <div class="rtitle">我的成绩 · ${year} ${SUBJ[subject]}</div>
          <p class="scmeta">满分 <b>150</b> · 选填 <b>${c.sel.max}</b> 分 + 大题 <b>${c.big.max}</b> 分</p>
        </div>
        <div class="scorenow"><span>当前得分</span><b data-score-sum="total">${fmtScore(c.total.score)}</b><i>/ 150</i></div>
      </div>
      <div class="scblock">
        <div class="scblock-head">
          <h4>选择 · 填空</h4>
          <span class="scblock-meta">选择 ${c.choice.max} 分 · 填空 ${c.fill.max} 分 · 选填 ${c.sel.max} 分</span>
          <div class="scbtns">
            <button class="minibtn" type="button" data-score-all>全选选填</button>
            <button class="minibtn" type="button" data-score-clear-sel>清空选填</button>
          </div>
        </div>
        <div class="qsgroup"><span class="qsgroup-lab">选择</span><div class="qsgrid">${choiceQs.map(chip).join('')}</div></div>
        <div class="qsgroup"><span class="qsgroup-lab">填空</span><div class="qsgrid">${fillQs.map(chip).join('')}</div></div>
        <p class="scsum">做对 <b data-score-correct>${c.sel.correct}</b> / ${c.sel.count} 题（已标记 <b data-score-set="sel">${c.sel.set}</b> / ${c.sel.count}）· 选填 <b data-score-sum="sel">${fmtScore(c.sel.score)}</b> / ${c.sel.max}</p>
      </div>
      <div class="scblock">
        <div class="scblock-head">
          <h4>解答题</h4>
          <span class="scblock-meta">${bigQs.length} 题 · ${c.big.max} 分</span>
          <div class="scbtns">
            <button class="minibtn" type="button" data-score-all-big title="把所有解答题填成满分，之后仍可逐题修改">大题全满分</button>
          </div>
        </div>
        <div class="bigrows">${bigRows}</div>
        <p class="scsum">已填 <b data-score-set="big">${c.big.set}</b> / ${c.big.count} 题 · 大题 <b data-score-sum="big">${fmtScore(c.big.score)}</b> / ${c.big.max}</p>
      </div>
      <div class="scorefoot">
        <span>点题号标记做对，再点一次标记做错；同题分数会自动同步到其他科目。未标记／未填写的题目按 0 分计。</span>
        <div class="scorefoot-btns">
          <button class="minibtn" type="button" data-score-sync title="同题已自动同步；这个按钮用于补齐以前留下的旧记录">补齐同题分数</button>
          <button class="minibtn danger" type="button" data-score-reset>清空本卷成绩</button>
        </div>
        <span class="scorestatus" data-score-status></span>
      </div>
    </section>`;
  }

  function repaintScorecard(card, year, subject) {
    const tmp = document.createElement('div');
    tmp.innerHTML = scorePanelHTML(year, subject);
    const fresh = tmp.firstElementChild;
    if (!fresh) return card;
    card.replaceWith(fresh);
    return fresh;
  }

  function setScoreStatus(card, msg) {
    const el = card && card.querySelector('[data-score-status]');
    if (el) el.textContent = msg;
  }

  function updateScoreSums(card, year, subject) {
    const c = computePaperScore(year, subject);
    const put = (sel, val) => {
      const el = card.querySelector(sel);
      if (el) el.textContent = val;
    };
    put('[data-score-set="big"]', c.big.set);
    put('[data-score-sum="big"]', fmtScore(c.big.score));
    put('[data-score-sum="total"]', fmtScore(c.total.score));
    put('[data-score-set="sel"]', c.sel.set);
    put('[data-score-sum="sel"]', fmtScore(c.sel.score));
    put('[data-score-correct]', c.sel.correct);
    card.classList.toggle('has-score', c.hasAny);
  }

  /* ── 题目卡 ── */
  function renderCard(q, subject, year, opts) {
    opts = opts || {};
    const lv = levelOf(year, subject, q.n);
    const key = isKeyQ(year, subject, q.n);
    const marked = WRONG.has(wrongKey(year, subject, q.n));
    const options = q.o
      ? `<div class="opts">${q.o.map((t, i) =>
          `<div class="opt${bigOpt(t) ? ' big' : ''}"><span class="ol">${'ABCD'[i]}</span><span>${safe(t)}</span></div>`).join('')}</div>`
      : '';
    const pdfBtns = opts.pdf
      ? `<button class="minilink" type="button" data-pdf="${opts.pdf.paper}" data-pdf-title="${opts.pdf.paperTitle}">做题本 PDF</button>
        <button class="minilink" type="button" data-pdf="${opts.pdf.sol}" data-pdf-title="${opts.pdf.solTitle}">做题本解析</button>`
      : `<button class="minilink" type="button" data-pdf="${paperPath(year, subject, 'paper')}" data-pdf-title="${year} 年${SUBJ[subject]}试卷">试卷 PDF</button>
        <button class="minilink" type="button" data-pdf="${paperPath(year, subject, 'sol')}" data-pdf-title="${year} 年${SUBJ[subject]}解析">解析 PDF</button>`;
    const originBtn = opts.origin
      ? `<button class="minilink" type="button" data-jump="${year},${subject},${q.n}">原卷定位</button>`
      : '';
    // 同一道题在同年多个卷子里出现时，在题号旁标出各卷的题号（如 数一3、数二2、数三4）
    const seenSame = new Set();
    const sameList = [[subject, q.n], ...otherSameQuestions(year, subject, q).map(o => [o.subject, o.q.n])]
      .filter(([s, n]) => {
        const k = `${s}-${n}`;
        if (seenSame.has(k)) return false;
        seenSame.add(k);
        return true;
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const sameTagHTML = sameList.length > 1
      ? `<span class="same-tag" title="同年同题：${sameList.map(([s, n]) => `${SUBJ[s]}第 ${n} 题`).join('，')}">同题 ${sameList.map(([s, n]) => `${shortSubj(s)}${n}`).join(' · ')}</span>`
      : '';
    return `<article class="qcard${key ? ' is-key' : ''}" id="q-${year}-${subject}-${q.n}" data-lv="${lv}"${key ? ' data-key="1"' : ''}>
      <div class="qhead">
        <span class="qnum">${q.n}</span>
        ${sameTagHTML}
        <span class="chip ${LV_CLASS[lv]}">${lv}</span>
        ${opts.showSubject ? `<span class="chip mod-tag">${SUBJ[subject]}</span>` : ''}
        <span class="chip mod-tag">${q.m}</span>
        ${key && !opts.inKey ? '<span class="chip key-tag">重点</span>' : ''}
        <span class="qmeta">考点：<b>${safe(q.t)}</b></span>
        ${stars(q.st)}
      </div>
      <div class="qtext">${safe(q.x)}</div>
      ${options}
      <div class="qfoot">
        <button class="ansbtn" type="button" aria-expanded="false">答案 · 解析</button>
        <button class="minilink wrongbtn" type="button" data-wrong="${year}-${subject}-${q.n}" aria-pressed="${marked}">${marked ? '已加入错题本' : '加入错题本'}</button>
        ${pdfBtns}
        ${originBtn}
      </div>
      <div class="ansbox" hidden>
        <div class="ansline"><span class="lab">答案</span><b>${safe(q.a)}</b></div>
        <div class="sol"><p>${safe(q.sol)}</p></div>
      </div>
    </article>`;
  }

  /* ── 年份条 ── */
  function renderYears() {
    const live = liveYears();
    yearsEl.innerHTML = ALL_YEARS.map(y => {
      const on = live.includes(y);
      return `<button class="year" type="button" data-year="${y}" aria-current="${y === state.year}"${on ? '' : ' disabled'}>${y}</button>`;
    }).join('');
    document.querySelectorAll('#modules .cnt:not(.wcnt)').forEach(el => { el.textContent = `${live.length}年`; });
    if (live.length) {
      const first = live[0], last = live[live.length - 1];
      const contiguous = live.every((y, i) => y === first + i);
      noteEl.textContent = contiguous ? `已上线 ${first}—${last} · 其余整理中` : `已上线 ${live.length} 年 · 其余整理中`;
      const subB = document.querySelector('.sub b');
      if (subB) subB.textContent = contiguous ? `已上线 ${first}—${last}` : `已上线 ${live.length} 年`;
      // 页脚统计：已上线年份的套卷数与题目总数
      const foot = document.getElementById('footStat');
      if (foot) {
        const papers = live.length * 3;
        const total = live.reduce((a, y) => a + (YEAR_INFO[y] || 0), 0);
        foot.textContent = `${first}—${last} · ${papers} 套卷 · ${total} 题`;
      }
    } else {
      noteEl.textContent = '整理中';
    }
    const cur = yearsEl.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /* ── 数学一/二/三：正文 ── */
  function subjectHTML(subject) {
    const year = state.year;
    const review = REVIEW[year];
    const paper = PAPERS[`${year}-${subject}`] || [];
    const d = DIST[year][subject];
    const kps = KP[year][subject];
    const keyNos = KP_KEY[year][subject];

    // 官方未公布平均分的年份，meta 里写字符串（如「未公布」），不再追加「分」
    const avgText = v => typeof v === 'number' ? `${v}<small>分</small>` : String(v);
    const scores = [1, 2, 3].map(s =>
      `<div class="scorecell${s === subject ? ' now' : ''}">
        <div class="lab">${SUBJ[s]}平均分</div>
        <div class="val">${avgText(review.avg[s])}</div>
      </div>`).join('');

    const reviewCard = `<div class="card review">
      <div class="rtitle">真题评价 · ${year} · ${review.overall}</div>
      <ul>${review.bullets.map(b => `<li><span>${safe(b)}</span></li>`).join('')}</ul>
      <p class="quote">${safe(review.quote)}</p>
    </div>`;

    const distRows = [['easy', '常规题'], ['mid', '中档题'], ['hard', '难题']].map(([k, label]) =>
      `<div class="distrow">
        <span class="tag ${k[0]}">${label}</span>
        <span class="qs">${d[k].qs}</span>
        <span class="sc"><b>${d[k].score} 分</b> · ${d[k].pct}%</span>
      </div>`).join('');

    const distCard = `<div class="card dist">
      <div class="serif" style="font-weight:700;font-size:14px;margin-bottom:6px">难度分布 · ${SUBJ[subject]}</div>
      <div class="distbar">
        <span class="e" style="width:${d.easy.score / 1.5}%"></span>
        <span class="m" style="width:${d.mid.score / 1.5}%"></span>
        <span class="h" style="width:${d.hard.score / 1.5}%"></span>
      </div>
      <div class="distrows">${distRows}</div>
      <p class="distnote">按分值统计（满分 150）。常规题约 ${d.easy.score} 分，是保底分。</p>
    </div>`;

    const kpCols = [1, 2, 3].map(s => {
      const list = KP[year][s];
      const keys = KP_KEY[year][s] || [];
      return `<div class="kpcol">
        <h3>${SUBJ[s]}</h3>
        <ol>${list.map((t, i) => {
          const no = i + 1;
          return `<li class="${keys.includes(no) ? 'is-key' : ''}"><span class="no">${String(no).padStart(2, '0')}</span><span class="txt">${safe(t)}</span></li>`;
        }).join('')}</ol>
      </div>`;
    }).join('');

    const kpCard = `<div class="card kpwrap">
      <div class="kpgrid">${kpCols}</div>
      <p class="distnote">考点按题号逐一标注；红字为当年重点题。</p>
    </div>`;

    // 筛选不重建页面：所有题目都渲染出来，切换难度/重点时只改显隐
    const filters = `<div class="filters" role="group" aria-label="筛选">
      ${[['all', '全部'], ['常规', '常规'], ['中档', '中档'], ['难题', '难题']].map(([v, label]) => {
        const on = !state.keyOnly && (state.level === v || (v === 'all' && state.level === 'all'));
        return `<button class="fbtn" type="button" data-filter="${v}" aria-pressed="${on}">${label}</button>`;
      }).join('')}
      <button class="fbtn key" type="button" data-filter="key" aria-pressed="${state.keyOnly}">只看重点</button>
      <span class="fcount">显示 ${paper.length} / ${paper.length} 题</span>
    </div>`;

    const groups = groupsFor(year).map(g => {
      const qs = paper.filter(q => q.n >= g.from && q.n <= g.to);
      if (!qs.length) return '';
      return `<section class="qgroup">
        <div class="qgroup-head"><h3>${g.title}</h3><span>${g.meta}</span></div>
        ${qs.map(q => renderCard(q, subject, year)).join('')}
      </section>`;
    }).join('');

    return `<header class="yearhero">
        <div>
          <p class="kicker">${year} · ${SUBJ[subject]}</p>
          <h2>${year} 年${SUBJ[subject]}真题</h2>
          <p class="meta">${paper.length} 题 · 满分 150 分 · 建议 <b>${review.time} 分钟</b> · 整体 <b>${review.overall}</b></p>
        </div>
        <div class="pdfbtns">
          <button class="btn primary" type="button" data-pdf="${paperPath(year, subject, 'paper')}" data-pdf-title="${year} 年${SUBJ[subject]}试卷">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/><path d="M6 9h4M6 11.5h4"/></svg>试卷 PDF</button>
          <button class="btn" type="button" data-pdf="${paperPath(year, subject, 'sol')}" data-pdf-title="${year} 年${SUBJ[subject]}解析">解析 PDF</button>
          <button class="btn" type="button" data-pdf="${reviewPath(year)}" data-pdf-title="${year} 年真题评价 & 重点题">真题评价</button>
        </div>
      </header>
      <div class="scorestrip">${scores}</div>
      <section class="section">${scorePanelHTML(year, subject)}</section>
      <section class="section">${reviewCard}</section>
      <section class="section">${distCard}</section>
      <section class="section">
        <div class="sec-head"><h2>考点总览</h2><span class="hint">${SUBJ[subject]} · ${kps.length} 个考点</span></div>
        ${kpCard}
      </section>
      <section class="section">
        <div class="sec-head"><h2>逐题精析</h2><span class="hint">点击「答案 · 解析」展开</span></div>
        ${filters}
        ${groups || '<div class="card empty">该年份题目整理中</div>'}
        <div class="card empty filter-empty" hidden>没有符合筛选条件的题目</div>
      </section>`;
  }

  /* ── 重点题 ── */
  function keyHTML() {
    const year = state.year;
    const groups = KEY_GROUPS[year] || [];
    // 同一道题会同时出现在数一/数二/数三的试卷里（题干完全一致），
    // 重点题里只列一次，并在卡片上标注考过它的卷子与题号
    const firstSeen = new Map();   // 题干 -> { groupIndex, topic, papers: [[subject, n], ...] }
    const layout = groups.map((g, gi) => {
      const cards = [];
      const refs = [];
      g.items.forEach(([subject, n]) => {
        const q = getQ(year, subject, n);
        if (!q) return;
        const stem = String(q.x).trim();
        const hit = firstSeen.get(stem);
        if (hit) {
          hit.papers.push([subject, n]);
          if (hit.groupIndex !== gi) refs.push({ topic: hit.topic, index: hit.groupIndex });
          return;
        }
        const rec = { q, subject, n, papers: [[subject, n]] };
        firstSeen.set(stem, { groupIndex: gi, topic: g.topic, papers: rec.papers });
        cards.push(rec);
      });
      return { g, gi, cards, refs };
    });
    const rawTotal = groups.reduce((s, g) => s + g.items.length, 0);
    const total = firstSeen.size;

    const body = layout.map(({ g, gi, cards, refs }) => {
      const cardHTML = cards
        .map(c => renderCard(c.q, c.subject, year, { showSubject: true, inKey: true, alsoIn: c.papers }))
        .join('');
      const refHTML = refs.map(r =>
        `<p class="dupref">同题已在第 ${String(r.index + 1).padStart(2, '0')} 组「${safe(r.topic)}」列出</p>`).join('');
      return `<article class="keytopic">
        <div class="topicbox">
          <div class="idx">${String(gi + 1).padStart(2, '0')} / ${String(groups.length).padStart(2, '0')}</div>
          <h4>${safe(g.topic)}</h4>
          <button class="ansbtn" type="button" aria-expanded="false">答案 · 解析</button>
          <div class="ansbox" hidden><p class="note">${safe(g.note)}</p></div>
        </div>
        <div class="qlist">${cardHTML}${refHTML}</div>
      </article>`;
    }).join('');

    return `<header class="yearhero">
        <div>
          <p class="kicker">重点题 · ${year}</p>
          <h2>${year} 年重点题</h2>
          <p class="meta"><b>${groups.length}</b> 组 · <b>${total}</b> 题 · 同一考点跨卷对比${total < rawTotal ? ' · 同题已合并' : ''}</p>
        </div>
        <div class="pdfbtns">
          <button class="btn primary" type="button" data-pdf="${reviewPath(year)}" data-pdf-title="${year} 年真题评价 & 重点题">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/><path d="M6 9h4M6 11.5h4"/></svg>重点题 PDF</button>
        </div>
      </header>
      <section class="section">${body || '<div class="card empty">该年份重点题整理中</div>'}</section>`;
  }

  /* ── 数一补充真题 ── */
  function suppHTML() {
    const year = state.year;
    const groups = SUPP[year] || [];
    const total = groups.reduce((s, g) => s + g.nums.length, 0);
    const suppPdf = {
      paper: 'pdfs/supplement/m1-supplement-paper.pdf',
      sol: 'pdfs/supplement/m1-supplement-sol.pdf',
      paperTitle: `${year} 年数一补充真题做题本`,
      solTitle: `${year} 年数一补充真题解析`
    };

    const table = groups.map(g => {
      const items = g.nums.map(n => {
        const q = getQ(year, g.from, n);
        if (!q) return '';
        return `<li>
          <span class="src">${SUBJ[g.from].replace('数学', '数')} ${String(n).padStart(2, '0')}</span>
          <a href="#q-${year}-${g.from}-${n}"><span class="tp">${safe(q.t)}</span></a>
          <span class="st">${'★'.repeat(q.st)}</span>
        </li>`;
      }).join('');
      return `<div class="card supp-card" id="supp-${year}-${g.from}">
        <h4>${g.title} · ${g.nums.length} 题</h4>
        <ul class="supp-list">${items}</ul>
      </div>`;
    }).join('');

    const detail = groups.map(g => {
      const qs = g.nums.map(n => getQ(year, g.from, n)).filter(Boolean);
      if (!qs.length) return '';
      return `<section class="qgroup">
        <div class="qgroup-head">
          <h3>${g.title} · 逐题</h3>
          <span>${qs.length} 题 · 题号对应 ${year} 年${SUBJ[g.from]}试卷</span>
        </div>
        ${qs.map(q => renderCard(q, g.from, year, { showSubject: true, origin: true, pdf: suppPdf })).join('')}
      </section>`;
    }).join('');

    return `<header class="yearhero">
        <div>
          <p class="kicker">补充真题 · ${year}</p>
          <h2>${year} 年数一补充真题</h2>
          <p class="meta">从数二、数三试卷中筛选的数一可做题 · 共 <b>${total}</b> 题</p>
        </div>
        <div class="pdfbtns">
          <button class="btn primary" type="button" data-pdf="pdfs/supplement/m1-supplement-paper.pdf" data-pdf-title="数学（一）补充真题做题本">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/><path d="M6 9h4M6 11.5h4"/></svg>做题本 PDF</button>
          <button class="btn" type="button" data-pdf="pdfs/supplement/m1-supplement-sol.pdf" data-pdf-title="数学（一）补充真题解析">解析 PDF</button>
        </div>
      </header>
      <div class="card supp-intro">
        <p><b>怎么用：</b>数一考生在刷完数一真题后，可把数二、数三中符合数一大纲的题目当作额外练习。这里按年份把补充题对照回原卷题号，并逐题列出题干、答案与解析。</p>
        <p>点击对照表中的题号，可直接定位到下方对应题目；每题右下角的「原卷定位」会跳回该题在数二／数三真题页的位置。</p>
      </div>
      <section class="section">
        <div class="sec-head"><h2>${year} 年补充题对照</h2><span class="hint">按来源分列 · 点击定位</span></div>
        <div class="supp-grid">${table || '<div class="card empty">该年份补充真题整理中</div>'}</div>
        <p class="supp-note">题号后星级为该题难度（1—5★），与真题页一致。</p>
      </section>
      <section class="section">
        <div class="sec-head"><h2>补充真题 · 逐题精析</h2><span class="hint">点击「答案 · 解析」展开</span></div>
        ${detail || '<div class="card empty">该年份补充真题整理中</div>'}
      </section>`;
  }

  /* ── 错题本 ── */
  function wrongEntries() {
    return [...WRONG]
      .map(k => k.split('-').map(Number))
      .filter(([year, subject, n]) => getQ(year, subject, n))
      .sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  }

  function wrongHTML() {
    const entries = wrongEntries();

    const head = `<header class="yearhero">
        <div>
          <p class="kicker">错题本</p>
          <h2>我的错题本</h2>
          <p class="meta">${entries.length
            ? `共 <b>${entries.length}</b> 题 · 覆盖 <b>${new Set(entries.map(e => e[0])).size}</b> 个年份 · 数一 ${entries.filter(e => e[1] === 1).length} · 数二 ${entries.filter(e => e[1] === 2).length} · 数三 ${entries.filter(e => e[1] === 3).length}`
            : '在任意题目卡片点「加入错题本」，这里就会自动归档'}</p>
        </div>
        ${entries.length ? `<div class="pdfbtns">
          <button class="btn primary" type="button" data-wrong-export>导出 PDF</button>
          <button class="btn" type="button" data-wrong-practice>导出做题本</button>
          <button class="btn" type="button" data-wrong-clear>清空错题本</button></div>` : ''}
      </header>`;

    if (!entries.length) {
      return `${head}
        <div class="card empty">错题本还是空的。浏览真题时，点题目右下角的「加入错题本」即可收录，再点一次取消；收藏的题目会永久留在本机浏览器里。</div>`;
    }

    const byGroup = new Map();
    entries.forEach(([year, subject, n]) => {
      const k = `${year}-${subject}`;
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(n);
    });

    const sections = [...byGroup.entries()].map(([k, nums]) => {
      const [year, subject] = k.split('-').map(Number);
      return `<section class="qgroup">
        <div class="qgroup-head"><h3>${year} 年 · ${SUBJ[subject]}</h3><span>${nums.length} 题</span></div>
        ${nums.map(n => {
          const q = getQ(year, subject, n);
          return q ? renderCard(q, subject, year, { origin: true }) : '';
        }).join('')}
      </section>`;
    }).join('');

    return `${head}
      <div class="card supp-intro">
        <p><b>说明：</b>错题保存在本机浏览器（localStorage）里，换浏览器或清除网站数据会丢失。点题目上的「已加入错题本」可移出。</p>
        <p>「原卷定位」会跳回该题所在的真题页；「试卷 PDF」「解析 PDF」打开对应原卷。</p>
        <p>「导出 PDF」会把整本错题按「年份 · 科目」排成 A4 打印版（含题干、选项、答案与解析），在打印对话框里选「存储为 PDF」即可得到文件。</p>
        <p>「导出做题本」只印题目、不带答案：选择填空每页两道，解答题一题一页，每题下面留出答题空白，适合把错题重新做一遍再对答案。</p>
      </div>
      <section class="section">
        <div class="sec-head"><h2>错题清单</h2><span class="hint">按年份倒序 · 同一年份内按科目</span></div>
        ${sections}
      </section>`;
  }

  /* ── 成绩统计 ── */
  const TYPE_SERIES = [
    { key: 'sel', label: '选填', color: 'var(--series-1)' },
    { key: 'big', label: '大题', color: 'var(--series-2)' },
    { key: 'total', label: '总分', color: 'var(--series-3)' }
  ];
  const MODULE_SERIES = [
    { key: '高数', label: '高数', color: 'var(--series-1)' },
    { key: '线代', label: '线代', color: 'var(--series-2)' },
    { key: '概率', label: '概率', color: 'var(--series-3)' }
  ];
  const STAT_DEFS = [
    { key: 'total', label: '总分' },
    { key: 'choice', label: '选择' },
    { key: 'fill', label: '填空' },
    { key: 'sel', label: '选填' },
    { key: 'big', label: '大题' },
    { key: '高数', label: '高数' },
    { key: '线代', label: '线代' },
    { key: '概率', label: '概率' }
  ];

  let STATS_CHARTS = [];
  const statsChartWidth = () => Math.max(280, Math.min(820, Math.floor(appEl.clientWidth || 640)));

  function statsCounts() {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const [k, rec] of Object.entries(SCORES)) {
      const s = Number(k.split('-')[1]);
      if (counts[s] !== undefined && rec.touched !== false) counts[s]++;
    }
    return counts;
  }

  function statsRows(subject) {
    return ALL_YEARS
      .filter(y => LOADED_YEARS.has(y) && scoreRec(y, subject) && scoreRec(y, subject).touched !== false)
      .map(y => computePaperScore(y, subject))
      .filter(r => r.hasAny)
      .sort((a, b) => b.year - a.year);
  }

  function statCardHTML(def, rows, subject) {
    if (def.key === '概率' && subject === 2) {
      return `<div class="stat">
        <span class="stat-label">概率</span>
        <span class="stat-value">不考</span>
        <span class="stat-sub">数学二不考该模块</span>
      </div>`;
    }
    const list = def.key === 'total'
      ? rows.filter(r => r.sel.any && r.big.any)
      : rows.filter(r => r[def.key] && r[def.key].any && r[def.key].max > 0);
    const avg = list.length ? list.reduce((s, r) => s + r[def.key].score, 0) / list.length : null;
    const rate = list.length ? list.reduce((s, r) => s + r[def.key].pct, 0) / list.length : null;
    const maxes = [...new Set(list.map(r => r[def.key].max))].sort((a, b) => a - b);
    const maxText = def.key === 'total'
      ? '150'
      : !maxes.length ? '—' : maxes.length === 1 ? String(maxes[0]) : `${maxes[0]}—${maxes[maxes.length - 1]}`;
    const value = avg === null ? '—'
      : def.key === 'total' ? `${fmtScore(avg)}<small>/ 150</small>` : `${fmtScore(avg)}<small>分</small>`;
    const sub = avg === null
      ? `满分 ${maxText}<br>还没有记录`
      : `得分率 ${Math.round(rate)}% · 满分 ${maxText}<br>记录 ${list.length} 年`;
    return `<div class="stat">
      <span class="stat-label">${def.label}</span>
      <span class="stat-value">${value}</span>
      <span class="stat-sub">${sub}</span>
    </div>`;
  }

  // 折线图只比较得分率：不同年份满分不同，直接比原始分没有意义
  function chartValue(row, key) {
    if (key === 'total') return row.sel.any && row.big.any ? row.total : null;
    const c = row[key];
    return c && c.any && c.max > 0 ? c : null;
  }

  function chartPoints(rows, series) {
    return rows
      .slice()
      .sort((a, b) => a.year - b.year)
      .map(r => {
        const vals = {};
        let any = false;
        for (const s of series) {
          const c = chartValue(r, s.key);
          vals[s.key] = c ? { pct: c.pct, score: c.score, max: c.max } : null;
          if (c) any = true;
        }
        return any ? { year: r.year, vals } : null;
      })
      .filter(Boolean);
  }

  function buildChart(series, pts, width) {
    const active = series.filter(s => pts.some(p => p.vals[s.key]));
    if (!pts.length || !active.length) return null;

    const height = 232;
    const padL = 32, padR = 64, padT = 16, padB = 28;
    const plotW = Math.max(40, width - padL - padR);
    const plotH = height - padT - padB;
    const n = pts.length;
    const xs = pts.map((_, i) => n === 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1));
    const yOf = pct => padT + (1 - pct / 100) * plotH;

    let grid = '';
    for (const v of [0, 25, 50, 75, 100]) {
      const y = yOf(v);
      grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}"/>`;
      grid += `<text class="tick" x="${padL - 6}" y="${y + 3}" text-anchor="end">${v}%</text>`;
    }

    const stepPx = n > 1 ? plotW / (n - 1) : plotW;
    const dense = stepPx < 30;
    const every = Math.max(1, Math.ceil(30 / Math.max(stepPx, 1)));
    let xLabels = '';
    pts.forEach((p, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every && n > 3) return;
      const text = dense ? String(p.year).slice(2) : String(p.year);
      xLabels += `<text class="tick" x="${xs[i].toFixed(1)}" y="${height - 8}" text-anchor="middle">${text}</text>`;
    });

    let paths = '', dots = '';
    for (const s of active) {
      let d = '', pen = false;
      pts.forEach((p, i) => {
        const v = p.vals[s.key];
        if (!v) { pen = false; return; }
        const y = yOf(v.pct);
        d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${y.toFixed(1)}`;
        pen = true;
        dots += `<circle class="dot" cx="${xs[i].toFixed(1)}" cy="${y.toFixed(1)}" r="${dense ? 2.2 : 2.8}" fill="${s.color}"><title>${p.year} 年 ${s.label} ${Math.round(v.pct)}%</title></circle>`;
      });
      if (d) paths += `<path class="series-line" d="${d}" stroke="${s.color}"/>`;
    }

    const ends = active.map(s => {
      for (let i = pts.length - 1; i >= 0; i--) {
        if (pts[i].vals[s.key]) return { s, y: yOf(pts[i].vals[s.key].pct) };
      }
      return null;
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
    }
    const endLabels = ends.map(e => {
      const y = Math.min(padT + plotH, Math.max(padT, e.y));
      return `<text class="end-label" x="${padL + plotW + 7}" y="${(y + 3).toFixed(1)}">${e.s.label}</text>`;
    }).join('');

    const crosshair = `<line class="crosshair" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"/>`;
    const svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="历年得分率折线图">${grid}${xLabels}${crosshair}${paths}${dots}${endLabels}</svg>`;
    return { svg, data: { pts, xs, width, active } };
  }

  function chartTipHTML(p, active) {
    const rows = active.map(s => {
      const v = p.vals[s.key];
      return `<div class="tip-row"><span><i style="background:${s.color}"></i>${s.label}</span>${
        v ? `<b>${Math.round(v.pct)}%<em> ${fmtScore(v.score)}/${v.max}</em></b>` : '<b class="empty">—</b>'
      }</div>`;
    }).join('');
    return `<div class="tip-year">${p.year} 年</div>${rows}`;
  }

  function bindChart(wrap, data) {
    const svg = wrap.querySelector('.chart');
    const tip = wrap.querySelector('.chart-tip');
    if (!svg || !tip) return;

    const show = clientX => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const scale = rect.width / data.width;
      const cx = (clientX - rect.left) / scale;
      const last = data.pts.length - 1;
      let idx = 0;
      if (last > 0) {
        const step = (data.xs[last] - data.xs[0]) / last;
        idx = Math.round((cx - data.xs[0]) / (step || 1));
        idx = Math.max(0, Math.min(last, idx));
      }
      const x = data.xs[idx];
      const cross = svg.querySelector('.crosshair');
      if (cross) {
        cross.setAttribute('x1', x);
        cross.setAttribute('x2', x);
        cross.style.opacity = '1';
      }
      tip.innerHTML = chartTipHTML(data.pts[idx], data.active);
      tip.hidden = false;
      const tipW = tip.offsetWidth;
      let left = x * scale + 12;
      if (left + tipW > rect.width - 4) left = x * scale - tipW - 12;
      if (left < 4) left = 4;
      tip.style.left = `${left}px`;
      tip.style.top = '8px';
    };

    const hide = () => {
      tip.hidden = true;
      const cross = svg.querySelector('.crosshair');
      if (cross) cross.style.opacity = '0';
    };

    wrap.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch') show(e.clientX);
    });
    wrap.addEventListener('pointerdown', e => show(e.clientX));
    wrap.addEventListener('pointerleave', e => {
      if (e.pointerType !== 'touch') hide();
    });
  }

  function bindStatsCharts() {
    if (!STATS_CHARTS.length) return;
    appEl.querySelectorAll('.chartwrap[data-chart]').forEach(wrap => {
      const data = STATS_CHARTS[Number(wrap.dataset.chart)];
      if (data) bindChart(wrap, data);
    });
  }

  function yearCardHTML(r) {
    const totalReady = r.sel.any && r.big.any;
    const defs = [
      ['choice', '选择', r.choice],
      ['fill', '填空', r.fill],
      ['sel', '选填', r.sel],
      ['big', '大题', r.big],
      ['total', '总分', r.total],
      ['高数', '高数', r['高数']],
      ['线代', '线代', r['线代']],
      ['概率', '概率', r['概率']]
    ];
    const rows = defs.filter(([key, , c]) => c && c.max > 0).map(([key, label, c]) => {
      const ready = key === 'total' ? totalReady : c.any;
      const pct = ready ? Math.min(100, c.score / c.max * 100) : 0;
      const score = ready ? `${fmtScore(c.score)}<i>/ ${c.max}</i>` : `—<i>/ ${c.max}</i>`;
      const strong = key === 'sel' || key === 'big' || key === 'total';
      return `<div class="scorerow${strong ? ' strong' : ''}">
        <span class="scorerow-lab">${label}</span>
        <span class="smeter"><i style="width:${pct.toFixed(1)}%"></i></span>
        <span class="scorerow-score${ready ? '' : ' empty'}">${score}</span>
      </div>`;
    }).join('');

    const totalText = totalReady ? `${fmtScore(r.total.score)} / 150 · ${Math.round(r.total.pct)}%` : '总分待补全';
    return `<section class="card yearcard">
      <div class="sumsec-head">
        <span class="sumsec-title">${r.year} 年 · ${shortSubj(r.subject)}</span>
        <span class="yearcard-actions">
          <span class="sumsec-avg">${totalText}</span>
          <button class="minibtn yearopen" type="button" data-stats-open="${r.year},${r.subject}">查看试卷</button>
        </span>
      </div>
      <div class="scorerows">${rows}</div>
    </section>`;
  }

  function statsHTML() {
    STATS_CHARTS = [];
    const subject = state.statsSubject;
    const rows = statsRows(subject);
    const counts = statsCounts();
    const seg = [1, 2, 3].map(s =>
      `<button class="segbtn" type="button" data-stats-subj="${s}" aria-pressed="${s === subject}">${SUBJ[s]}<span class="cnt">${counts[s]}</span></button>`
    ).join('');
    const header = `<header class="yearhero statshead">
      <div>
        <p class="kicker">成绩统计</p>
        <h2>我的成绩统计</h2>
        <p class="meta">${SUBJ[subject]} · ${rows.length
          ? `已记录 <b>${rows.length}</b> 个年份 · 平均分 / 得分率（不同年份满分不同）`
          : '还没有成绩记录' } · 数据保存在本机浏览器</p>
      </div>
      <div class="segmented" role="group" aria-label="选择科目">${seg}</div>
    </header>`;

    if (!rows.length) {
      return `${header}
        <div class="card statsempty">
          <p class="big">还没有 ${SUBJ[subject]} 的成绩记录</p>
          <p>回到真题页，在每年的「我的成绩」面板里标记选填对错、填写大题分数，这里会自动汇总历年成绩。</p>
          <button class="btn primary" type="button" data-stats-start="${subject}">去记录成绩</button>
        </div>`;
    }

    const cards = STAT_DEFS.map(def => statCardHTML(def, rows, subject)).join('');
    const width = statsChartWidth();

    const chartSection = (title, series, note) => {
      const built = buildChart(series, chartPoints(rows, series), width);
      if (!built) return '';
      const idx = STATS_CHARTS.length;
      STATS_CHARTS.push(built.data);
      const legend = built.data.active
        .map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
      return `<section class="sumsec">
        <div class="sumsec-head"><span class="sumsec-title">${title}</span><span class="sumsec-avg">${built.data.pts.length} 个年份 · 得分率</span></div>
        <div class="legend">${legend}</div>
        <div class="chartwrap" data-chart="${idx}">${built.svg}<div class="chart-tip" hidden></div></div>
        <p class="sumnote">${note}</p>
      </section>`;
    };

    const charts = chartSection('题型趋势', TYPE_SERIES, '未标记的选填和未填写的大题按 0 分计；总分只在该卷选填、大题都有记录时绘出。')
      + chartSection('模块趋势', MODULE_SERIES, '按题目的考点模块归类；数二不考概率，因此不会出现在图里。');

    const detail = `<section class="sumsec">
        <div class="sumsec-head"><span class="sumsec-title">逐年明细</span><span class="sumsec-avg">按年份倒序</span></div>
        <p class="sumnote">每一行都是「已得 / 满分」。选填和大题优先看；总分需要两部分都有记录才计算。</p>
      </section>` + rows.map(yearCardHTML).join('');

    return `${header}<div class="stats">${cards}</div>${charts}${detail}`;
  }

  /* ── 错题本导出 PDF：另建一份只用于打印的版式，交给浏览器「存储为 PDF」 ── */
  // 打印用的题目卡片；practice 版只留题目和答题空白，不带答案与解析
  function printCard(q, n, { label = '', practice = false, big = false } = {}) {
    const st = Math.max(0, Math.min(5, q.st || 0));
    const opts = q.o
      ? `<div class="opts">${q.o.map((t, i) =>
          `<div class="opt${bigOpt(t) ? ' big' : ''}"><span class="ol">${'ABCD'[i]}</span><span>${safe(t)}</span></div>`).join('')}</div>`
      : '';
    const head = `<div class="pqh"><span class="pno">${n}</span><span class="pkp">${label ? `${esc(label)} · ` : ''}${esc(q.m)} · ${safe(q.t)}</span><span class="pst">${'★'.repeat(st)}${'☆'.repeat(5 - st)}</span></div>`;
    if (practice) {
      return `<article class="pq practice${big ? ' big' : ''}">
        ${head}
        <div class="qtext">${safe(q.x)}</div>
        ${opts}
        <div class="pblank"><span>答题区</span></div>
      </article>`;
    }
    return `<article class="pq">
      ${head}
      <div class="qtext">${safe(q.x)}</div>
      ${opts}
      <div class="prow"><b>答案</b><span>${safe(q.a)}</span></div>
      ${q.sol ? `<div class="prow"><b>解析</b><span>${safe(q.sol)}</span></div>` : ''}
    </article>`;
  }

  function printDocHTML(entries) {
    const now = new Date();
    const pad = v => String(v).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const count = s => entries.filter(e => e[1] === s).length;

    const groups = new Map();
    entries.forEach(([year, subject, n]) => {
      const k = `${year}-${subject}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    });

    const sections = [...groups.entries()].map(([k, nums]) => {
      const [year, subject] = k.split('-').map(Number);
      const cards = nums.map(n => {
        const q = getQ(year, subject, n);
        return q ? printCard(q, n) : '';
      }).join('');
      return `<section class="pgroup"><h2>${year} 年 · ${SUBJ[subject]}</h2>${cards}</section>`;
    }).join('');

    return `<div class="print-doc">
      <header class="phd">
        <h1>考研数学 · 我的错题本</h1>
        <p>共 <b>${entries.length}</b> 题 ｜ 数一 ${count(1)} · 数二 ${count(2)} · 数三 ${count(3)} ｜ 导出日期 ${date}</p>
      </header>
      ${sections}
    </div>`;
  }

  // 做题本：只印题目、不带答案，小题每页两道、大题一页一道，留出答题空白
  function practiceDocHTML(entries) {
    const now = new Date();
    const pad = v => String(v).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // 大题（解答题）一题一页，小题（选择/填空）两题一页；顺序保持「年份倒序 · 同年按科目」
    const pages = [];
    let buf = [];
    let seq = 0;
    const flush = () => { if (buf.length) { pages.push(buf); buf = []; } };
    entries.forEach(([year, subject, n]) => {
      const q = getQ(year, subject, n);
      if (!q) return;
      const big = isBigQ(year, n);
      // 题号按做题顺序重新编号，原卷出处（年份·科目·题号）放在旁边
      const card = printCard(q, ++seq, { label: `${year} ${SUBJ[subject]}第 ${n} 题`, practice: true, big });
      if (big) { flush(); pages.push([card]); }
      else { buf.push(card); if (buf.length === 2) flush(); }
    });
    flush();

    return `<div class="print-doc practice">
      ${pages.map((pg, i) => `<section class="ppage">
        <div class="pph"><span>考研数学 · 错题做题本</span><span>第 ${i + 1} / ${pages.length} 页</span></div>
        ${i === 0 ? `<p class="pmeta">共 <b>${seq}</b> 题 · 小题每页 2 题、大题每页 1 题 · 导出日期 ${date}</p>` : ''}
        ${pg.join('')}
      </section>`).join('')}
    </div>`;
  }

  // 判大题：按当年卷面分组（选择/填空/解答）取题号区间，解答题即大题
  function isBigQ(year, n) {
    const g = groupsFor(year).find(g => n >= g.from && n <= g.to);
    return !!g && g.title.includes('解答');
  }

  let printRootEl = null;
  function exportPrint(html, practice) {
    if (printRootEl) printRootEl.remove();
    printRootEl = document.createElement('div');
    printRootEl.id = 'printRoot';
    if (practice) printRootEl.classList.add('practice');
    printRootEl.innerHTML = html;
    document.body.appendChild(printRootEl);
    document.documentElement.classList.add('printing');
    renderMath(printRootEl);

    const done = () => {
      document.documentElement.classList.remove('printing');
      if (printRootEl) { printRootEl.remove(); printRootEl = null; }
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    // 等 KaTeX 排版落地再唤起打印对话框
    setTimeout(() => { try { window.print(); } catch (e) { done(); } }, 150);
    setTimeout(done, 180000); // 极端情况下 afterprint 不触发时兜底清理
  }

  function exportWrongPDF() {
    const entries = wrongEntries();
    if (entries.length) exportPrint(printDocHTML(entries), false);
  }

  function exportPracticePDF() {
    const entries = wrongEntries();
    if (entries.length) exportPrint(practiceDocHTML(entries), true);
  }

  /* ── 主渲染 ── */
  // 复用已渲染好的 DOM 节点：切回同一年时既不重建页面，也不重排公式
  let renderToken = 0;

  const cacheKeyOf = () => state.view === 'stats'
    ? `stats|${state.statsSubject}|${statsChartWidth()}`
    : `${state.view}|${state.year}`;

  // 难度 / 重点筛选只改显隐，不重建页面
  function applyFilter() {
    if (!SUBJ_VIEW[state.view]) return;
    const cards = [...appEl.querySelectorAll('.qcard[data-lv]')];
    let shown = 0;
    cards.forEach(c => {
      const hide = (state.keyOnly && c.dataset.key !== '1')
        || (state.level !== 'all' && c.dataset.lv !== state.level);
      c.hidden = hide;
      if (!hide) shown++;
    });
    appEl.querySelectorAll('.qgroup').forEach(g => {
      const inner = [...g.querySelectorAll('.qcard[data-lv]')];
      g.hidden = inner.length > 0 && inner.every(c => c.hidden);
    });
    const cnt = appEl.querySelector('.fcount');
    if (cnt) cnt.textContent = `显示 ${shown} / ${cards.length} 题`;
    const empty = appEl.querySelector('.filter-empty');
    if (empty) empty.hidden = shown > 0 || !cards.length;
    appEl.querySelectorAll('.fbtn').forEach(b => {
      const v = b.dataset.filter;
      const on = v === 'key' ? state.keyOnly : (!state.keyOnly && state.level === v);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // 错题本 / 成绩统计会跨年份取题，涉及的年份都要先载入
  function neededYears() {
    if (state.view === 'stats') {
      const years = [...new Set(Object.keys(SCORES).map(k => Number(k.split('-')[0])))];
      return years.filter(y => ALL_YEARS.includes(y));
    }
    if (state.view !== 'wrong') return [state.year];
    const years = [...new Set([...WRONG].map(k => Number(k.split('-')[0])))];
    return years.length ? years.filter(y => ALL_YEARS.includes(y)) : [state.year];
  }

  function render() {
    const token = ++renderToken;
    const missing = neededYears().filter(y => !LOADED_YEARS.has(y));
    if (missing.length) {
      document.documentElement.dataset.loading = 'true';
      Promise.all(missing.map(loadYear)).then(() => {
        document.documentElement.dataset.loading = '';
        if (token === renderToken) renderNow();
      }, err => {
        document.documentElement.dataset.loading = '';
        if (token !== renderToken) return;
        appEl.innerHTML = `<div class="card empty">${err.message}。请检查网络后刷新重试。</div>`;
      });
      return;
    }
    renderNow();
  }

  function renderNow() {
    document.documentElement.dataset.view = state.view;
    try {
      const qs = new URLSearchParams({ view: state.view, year: String(state.year) });
      if (state.view === 'stats') qs.set('subj', String(state.statsSubject));
      history.replaceState(null, '', `?${qs}`);
    } catch (e) { /* file:// 下部分浏览器不允许改写地址 */ }

    reconcileLoadedScores();
    const cacheKey = cacheKeyOf();
    const cachedNodes = VIEW_CACHE.get(cacheKey);
    if (cachedNodes) {
      VIEW_CACHE.delete(cacheKey);      // 挪到队尾，LRU 淘汰最久未用的
      VIEW_CACHE.set(cacheKey, cachedNodes);
      appEl.replaceChildren(...cachedNodes);
    } else {
      const subject = SUBJ_VIEW[state.view];
      if (subject) appEl.innerHTML = subjectHTML(subject);
      else if (state.view === 'key') appEl.innerHTML = keyHTML();
      else if (state.view === 'wrong') appEl.innerHTML = wrongHTML();
      else if (state.view === 'stats') { appEl.innerHTML = statsHTML(); bindStatsCharts(); }
      else appEl.innerHTML = suppHTML();
      renderMath();
      VIEW_CACHE.set(cacheKey, [...appEl.childNodes]);
      if (VIEW_CACHE.size > VIEW_CACHE_MAX) VIEW_CACHE.delete(VIEW_CACHE.keys().next().value);
    }
    applyFilter();

    modulesEl.querySelectorAll('.mod').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    });
    const activeMod = modulesEl.querySelector('.mod[aria-pressed="true"]');
    if (activeMod) activeMod.scrollIntoView({ block: 'nearest', inline: 'center' });
    yearsEl.querySelectorAll('.year').forEach(b => {
      b.setAttribute('aria-current', String(Number(b.dataset.year) === state.year));
    });
  }

  function renderMath(root) {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(root || appEl, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
      });
    } catch (err) {
      console.warn('KaTeX 渲染失败：', err);
    }
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function jumpTo(year, subject, n) {
    state.view = 'm' + subject;
    state.year = year;
    state.level = 'all';
    state.keyOnly = false;
    const ready = LOADED_YEARS.has(year) ? Promise.resolve() : loadYear(year);
    ready.then(() => {
      render();
      requestAnimationFrame(() => {
        const el = document.getElementById(`q-${year}-${subject}-${n}`);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1700);
      });
    }).catch(() => {});
  }

  /* ── PDF 浮层 ── */
  function openPdf(path, title) {
    pdfTitleEl.textContent = title || 'PDF';
    frameEl.src = path;
    pdfOpenEl.href = path;
    sheetEl.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closePdf() {
    sheetEl.hidden = true;
    frameEl.src = 'about:blank';
    document.body.style.overflow = '';
  }

  /* ── 事件 ── */
  appEl.addEventListener('click', e => {
    const scoreQ = e.target.closest('[data-score-q]');
    if (scoreQ) {
      const card = scoreQ.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const n = Number(scoreQ.dataset.scoreQ);
      const rec = ensureScoreRec(year, subject);
      const cur = rec.sel[n];
      if (cur === 1) rec.sel[n] = 0;
      else if (cur === 0) delete rec.sel[n];
      else rec.sel[n] = 1;
      const synced = propagateScore(year, subject, n, rec.sel[n], false);
      pruneScoreRec(year, subject);
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      if (synced) setScoreStatus(fresh, `第 ${n} 题已自动同步到 ${synced} 道同题。`);
      return;
    }

    const scoreAll = e.target.closest('[data-score-all]');
    if (scoreAll) {
      const card = scoreAll.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const rec = ensureScoreRec(year, subject);
      let synced = 0;
      for (const q of (PAPERS[paperKey(year, subject)] || [])) {
        if (qKind(year, q.n) === 'big') continue;
        rec.sel[q.n] = 1;
        synced += propagateScore(year, subject, q.n, 1, false);
      }
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      setScoreStatus(fresh, `已全选选填${synced ? `，并同步 ${synced} 道同题` : ''}；点做错的题号可改为做错。`);
      return;
    }

    const scoreAllBig = e.target.closest('[data-score-all-big]');
    if (scoreAllBig) {
      const card = scoreAllBig.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const rec = ensureScoreRec(year, subject);
      let count = 0;
      let synced = 0;
      for (const q of (PAPERS[paperKey(year, subject)] || [])) {
        if (qKind(year, q.n) !== 'big') continue;
        rec.big[q.n] = qMax(year, q.n);
        synced += propagateScore(year, subject, q.n, rec.big[q.n], false);
        count++;
      }
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      setScoreStatus(fresh, `已把 ${count} 道大题填成满分，可继续逐题修改${synced ? `；并同步 ${synced} 道同题` : ''}。`);
      return;
    }

    const scoreClearSel = e.target.closest('[data-score-clear-sel]');
    if (scoreClearSel) {
      const card = scoreClearSel.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const rec = ensureScoreRec(year, subject);
      let synced = 0;
      for (const n of Object.keys(rec.sel).map(Number)) {
        synced += propagateScore(year, subject, n, undefined, false);
      }
      rec.sel = {};
      pruneScoreRec(year, subject);
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      if (synced) setScoreStatus(fresh, `已清空选填，并同步清除 ${synced} 道同题记录。`);
      return;
    }

    const scoreCopy = e.target.closest('[data-copy-big]');
    if (scoreCopy) {
      const card = scoreCopy.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const [srcSubject, srcN, tgtN] = scoreCopy.dataset.copyBig.split(',').map(Number);
      const src = scoreRec(year, srcSubject);
      const val = src ? src.big[srcN] : undefined;
      if (val === undefined) return;
      const rec = ensureScoreRec(year, subject);
      rec.big[tgtN] = Math.min(qMax(year, tgtN), Math.max(0, val));
      const synced = propagateScore(year, subject, tgtN, rec.big[tgtN], false);
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      setScoreStatus(fresh, `已从 ${SUBJ[srcSubject]} 第 ${srcN} 题复制 ${fmtScore(rec.big[tgtN])} 分${synced ? `，并同步 ${synced} 道同题` : ''}。`);
      return;
    }

    const scoreSync = e.target.closest('[data-score-sync]');
    if (scoreSync) {
      const card = scoreSync.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const res = syncSameScores(year, subject);
      const fresh = repaintScorecard(card, year, subject);
      setScoreStatus(fresh, res.count
        ? `已从其他科目同步 ${res.count} 道同题成绩。`
        : '没有找到其他科目里已记录的同题成绩。');
      return;
    }

    const scoreReset = e.target.closest('[data-score-reset]');
    if (scoreReset) {
      const card = scoreReset.closest('[data-scorecard]');
      if (!card) return;
      const year = Number(card.dataset.year);
      const subject = Number(card.dataset.subject);
      const rec = scoreRec(year, subject);
      if (!rec) return;
      if (!window.confirm(`清空 ${year} 年${SUBJ[subject]}的记录？其他科目的同题记录也会一并清除。`)) return;
      const selNs = Object.keys(rec.sel).map(Number);
      const bigNs = Object.keys(rec.big).map(Number);
      delete SCORES[paperKey(year, subject)];
      let synced = 0;
      for (const n of selNs) synced += propagateScore(year, subject, n, undefined, false);
      for (const n of bigNs) synced += propagateScore(year, subject, n, undefined, false);
      saveScores();
      const fresh = repaintScorecard(card, year, subject);
      setScoreStatus(fresh, `已清空本卷成绩${synced ? `，并同步清除 ${synced} 道同题记录` : ''}。`);
      return;
    }

    const wb = e.target.closest('[data-wrong]');
    if (wb) {
      const k = wb.dataset.wrong;
      if (WRONG.has(k)) WRONG.delete(k); else WRONG.add(k);
      saveWrong();
      VIEW_CACHE.clear();   // 缓存里的按钮状态已过期
      if (state.view === 'wrong') {
        const sy = window.scrollY;
        render();
        updateWrongBadge();
        window.scrollTo(0, sy);
      } else {
        syncWrongBtns();
      }
      return;
    }

    const expW = e.target.closest('[data-wrong-export]');
    if (expW) { exportWrongPDF(); return; }

    const pracW = e.target.closest('[data-wrong-practice]');
    if (pracW) { exportPracticePDF(); return; }

    const clearW = e.target.closest('[data-wrong-clear]');
    if (clearW) {
      if (!WRONG.size) return;
      if (!window.confirm(`清空错题本里的 ${WRONG.size} 道题？此操作不可撤销。`)) return;
      WRONG.clear();
      saveWrong();
      VIEW_CACHE.clear();
      updateWrongBadge();
      render();
      return;
    }

    const ans = e.target.closest('.ansbtn');
    if (ans) {
      // 题目卡里的按钮在 .qfoot 里，重点题的按钮紧挨着答案框，两种都支持
      const box = ans.nextElementSibling && ans.nextElementSibling.classList.contains('ansbox')
        ? ans.nextElementSibling
        : ans.closest('.qcard').querySelector('.ansbox');
      const open = box.hidden;
      box.hidden = !open;
      ans.setAttribute('aria-expanded', String(open));
      ans.textContent = open ? '收起解析' : '答案 · 解析';
      return;
    }

    const pdf = e.target.closest('[data-pdf]');
    if (pdf) {
      openPdf(pdf.dataset.pdf, pdf.dataset.pdfTitle);
      return;
    }

    const fbtn = e.target.closest('.fbtn');
    if (fbtn) {
      const v = fbtn.dataset.filter;
      if (v === 'key') {
        state.keyOnly = !state.keyOnly;
      } else {
        state.level = v;
        state.keyOnly = false;
      }
      applyFilter();
      return;
    }

    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      const [y, s, n] = jump.dataset.jump.split(',').map(Number);
      jumpTo(y, s, n);
      return;
    }

    const statsSeg = e.target.closest('[data-stats-subj]');
    if (statsSeg) {
      const s = Number(statsSeg.dataset.statsSubj);
      if (s === state.statsSubject) return;
      state.statsSubject = s;
      render();
      scrollTop();
      return;
    }

    const statsOpen = e.target.closest('[data-stats-open]');
    if (statsOpen) {
      const [y, s] = statsOpen.dataset.statsOpen.split(',').map(Number);
      state.view = `m${s}`;
      state.year = y;
      state.level = 'all';
      state.keyOnly = false;
      render();
      scrollTop();
      return;
    }

    const statsStart = e.target.closest('[data-stats-start]');
    if (statsStart) {
      const s = Number(statsStart.dataset.statsStart);
      state.statsSubject = s;
      state.view = `m${s}`;
      state.level = 'all';
      state.keyOnly = false;
      render();
      scrollTop();
    }
  });

  appEl.addEventListener('input', e => {
    const inp = e.target.closest('[data-score-big]');
    if (!inp) return;
    const card = inp.closest('[data-scorecard]');
    if (!card) return;
    const year = Number(card.dataset.year);
    const subject = Number(card.dataset.subject);
    const n = Number(inp.dataset.scoreBig);
    const raw = inp.value.trim();
    const rec = ensureScoreRec(year, subject);
    if (raw === '') {
      delete rec.big[n];
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v)) return;
      const clamped = Math.min(qMax(year, n), Math.max(0, v));
      rec.big[n] = clamped;
      if (clamped !== v) inp.value = fmtScore(clamped);
    }
    const synced = propagateScore(year, subject, n, rec.big[n], false);
    pruneScoreRec(year, subject);
    saveScores();
    updateScoreSums(card, year, subject);
    if (synced) setScoreStatus(card, `第 ${n} 题已自动同步到 ${synced} 道同题。`);
  });

  // 失焦时把越界或只写了一半的数字回填成实际存下的分数
  appEl.addEventListener('focusout', e => {
    const inp = e.target.closest('[data-score-big]');
    if (!inp) return;
    const card = inp.closest('[data-scorecard]');
    if (!card) return;
    const year = Number(card.dataset.year);
    const subject = Number(card.dataset.subject);
    const n = Number(inp.dataset.scoreBig);
    const rec = scoreRec(year, subject);
    const v = rec ? rec.big[n] : undefined;
    inp.value = v === undefined ? '' : fmtScore(v);
  });

  modulesEl.addEventListener('click', e => {
    const btn = e.target.closest('.mod');
    if (!btn) return;
    if (btn.dataset.view === 'stats') {
      const cur = SUBJ_VIEW[state.view];
      if (cur) state.statsSubject = cur;
    }
    state.view = btn.dataset.view;
    render();
    scrollTop();
  });

  yearsEl.addEventListener('click', e => {
    const btn = e.target.closest('.year');
    if (!btn || btn.disabled) return;
    state.year = Number(btn.dataset.year);
    render();
    scrollTop();
  });

  // 统计图表按容器宽度绘制，窗口尺寸变化后重画一次
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (state.view !== 'stats') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      VIEW_CACHE.delete(cacheKeyOf());
      render();
    }, 180);
  });

  document.getElementById('pdfClose').addEventListener('click', closePdf);
  sheetEl.addEventListener('click', e => {
    if (e.target === sheetEl) closePdf();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sheetEl.hidden) closePdf();
  });

  /* ── 启动 ── */
  const params = new URLSearchParams(location.search);
  const pv = params.get('view');
  if (pv && ['m1', 'm2', 'm3', 'key', 'supp', 'wrong', 'stats'].includes(pv)) state.view = pv;
  const ps = Number(params.get('subj'));
  if (ps >= 1 && ps <= 3) state.statsSubject = ps;
  const py = Number(params.get('year'));
  const live = liveYears();
  if (live.includes(py)) state.year = py;
  else if (live.length && !live.includes(state.year)) state.year = live[0];
  const hash = location.hash.match(/^#q-(\d{4})-(\d)-(\d+)$/);
  renderYears();
  updateWrongBadge();
  render();
  if (hash) jumpTo(Number(hash[1]), Number(hash[2]), Number(hash[3]));
})();

/* 页脚 Star 计数：离线或接口失败时只显示「给个 Star」 */
(function () {
  const el = document.getElementById('starCount');
  if (!el || typeof fetch !== 'function') return;
  fetch('https://api.github.com/repos/3456038583-gif/kaoyan-math-site', {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || typeof d.stargazers_count !== 'number') return;
      el.textContent = d.stargazers_count;
      el.hidden = false;
    })
    .catch(() => {});
})();
