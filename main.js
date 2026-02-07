/* 장기 기보 뷰어 (Pure HTML/CSS/JS)
 *
 * 좌표 체계(중요)
 * - 표기: a1 ~ i10
 * - 파일(file): a~i (좌→우)
 * - 랭크(rank): 1~10 (아래(한)→위(초))
 * - 내부 인덱스:
 *   x = 0..8 (a=0, i=8)
 *   y = 0..9 (위쪽이 0, 아래쪽이 9)
 *   따라서 rank -> y 변환은: y = 10 - rank
 *
 * "10행(=rank 10)"을 항상 두 글자 좌표로 유지하기 위해,
 * URL의 pgn 좌표에서 rank 10은 '0'으로 표기할 수 있게 허용한다.
 * 예: e0 == e10
 *
 * sp 변형 로직(중요)
 * - sp는 두 자리 문자열. 첫자리: 초(위쪽) 마/상 배치, 둘째자리: 한(아래쪽) 마/상 배치
 * - 각 숫자 의미(좌->우, b,c,g,h 네 칸만 결정):
 *   1 = 마상상마 : b=마, c=상, g=상, h=마
 *   2 = 마상마상 : b=마, c=상, g=마, h=상
 *   3 = 상마상마 : b=상, c=마, g=상, h=마
 *   4 = 상마마상 : b=상, c=마, g=마, h=상
 *
 * 참고로, 보드(격자/궁성 대각선) 표현 방식은 첨부한 장기판.html의
 * "격자+대각선(궁성)" 요구를 충족하도록 SVG로 그리도록 구성했다. :contentReference[oaicite:0]{index=0}
 */

(() => {
    const $ = (sel) => document.querySelector(sel);

    // DOM
    const boardWrap = $("#boardWrap");
    const boardSvg = $("#boardSvg");
    const gridLayer = $("#gridLayer");
    const labelLayer = $("#labelLayer");

    const pieceLayer = $("#pieceLayer");
    const hlFrom = $("#hlFrom");
    const hlTo = $("#hlTo");

    const btnFirst = $("#btnFirst");
    const btnPrev = $("#btnPrev");
    const btnNext = $("#btnNext");
    const btnLast = $("#btnLast");
    const btnReload = $("#btnReload");

    const plyPill = $("#plyPill");
    const moveText = $("#moveText");
    const msgBox = $("#msgBox");
    const endBadge = $("#endBadge");
    const subtitle = $("#subtitle");
    const hintText = $("#hintText");

    // Board geometry (SVG space)
    const VIEW = { w: 1000, h: 1100 };
    const INNER = { x: 110, y: 120, w: 780, h: 860 }; // "격자"가 들어갈 영역(라벨/여백 제외)
    // Grid: 9 files -> 9 vertical lines (x=0..8), 10 ranks -> 10 horizontal lines (y=0..9)
    const FILES = 9;
    const RANKS = 10;

    // Runtime layout in CSS pixels (computed from boardWrap size)
    const layout = {
        cellW: 0,
        cellH: 0,
        // inner rect in CSS px
        innerLeft: 0,
        innerTop: 0,
        innerW: 0,
        innerH: 0,
        pieceSize: 0,
        hlSize: 0,
    };

    // Pieces
    // Codes: side(초/한) + kind(차/마/상/사/장/포/졸)
    const PIECE_IMG = {
        "초차": "./assets/초차.svg",
        "초마": "./assets/초마.svg",
        "초상": "./assets/초상.svg",
        "초사": "./assets/초사.svg",
        "초장": "./assets/초궁.svg",
        "초포": "./assets/초포.svg",
        "초졸": "./assets/초졸.svg",

        "한차": "./assets/한차.svg",
        "한마": "./assets/한마.svg",
        "한상": "./assets/한상.svg",
        "한사": "./assets/한사.svg",
        "한장": "./assets/한궁.svg",
        "한포": "./assets/한포.svg",
        "한졸": "./assets/한병.svg",
    };

    // Snapshot-based state
    // state.board[y][x] = pieceCode or null
    let snapshots = []; // array of { board, lastMoveRaw, lastMove, warnings[] }
    let moves = [];     // parsed moves { raw, from, to, isPass, ok, warn }
    let ply = 0;        // current ply index (0..moves.length)
    let lastError = null;

    // ---------------------------
    // Utilities
    // ---------------------------
    function showMsg(text) {
        msgBox.hidden = !text;
        msgBox.textContent = text || "";
    }

    function appendMsg(line) {
        const prev = msgBox.hidden ? "" : msgBox.textContent;
        showMsg(prev ? (prev + "\n" + line) : line);
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function fileCharToX(ch) {
        const c = (ch || "").toLowerCase();
        const code = c.charCodeAt(0);
        if (code < 97 || code > 105) return null; // a..i
        return code - 97;
    }

    function rankCharToRank(ch) {
        // '1'..'9' => 1..9, '0' => 10
        if (ch === "0") return 10;
        const n = Number(ch);
        if (!Number.isInteger(n) || n < 1 || n > 9) return null;
        return n;
    }

    function coordToXY(coord) {
        // coord: "e5" or "e0"(=e10)
        if (!coord || coord.length !== 2) return { ok: false, reason: `좌표 길이 오류: ${coord}` };
        const x = fileCharToX(coord[0]);
        const r = rankCharToRank(coord[1]);
        if (x == null) return { ok: false, reason: `파일 오류: ${coord}` };
        if (r == null) return { ok: false, reason: `랭크 오류: ${coord}` };
        const y = 10 - r;
        if (y < 0 || y > 9) return { ok: false, reason: `범위 오류: ${coord}` };
        return { ok: true, x, y, rank: r };
    }

    function xyToCoord(x, y) {
        const file = String.fromCharCode(97 + x);
        const rank = 10 - y;
        // 10행은 '0'으로 출력 (요구사항)
        const rch = (rank === 10) ? "0" : String(rank);
        return file + rch;
    }

    function deepCopyBoard(board) {
        return board.map(row => row.slice());
    }

    function makeEmptyBoard() {
        return Array.from({ length: RANKS }, () => Array.from({ length: FILES }, () => null));
    }

    // ---------------------------
    // Initial placement
    // ---------------------------
    function spPatternToFourKinds(n) {
        // returns array for [b,c,g,h] among ["마","상"] sequence
        switch (String(n)) {
            case "1": return ["마", "상", "상", "마"]; // 마상상마
            case "2": return ["마", "상", "마", "상"]; // 마상마상
            case "3": return ["상", "마", "상", "마"]; // 상마상마
            case "4": return ["상", "마", "마", "상"]; // 상마마상
            default: return null;
        }
    }

    function placeInitial(spStr) {
        const board = makeEmptyBoard();
        const sp = (spStr || "44");
        const choN = sp[0] || "4";
        const hanN = sp[1] || "4";

        const choPat = spPatternToFourKinds(choN) || spPatternToFourKinds("4");
        const hanPat = spPatternToFourKinds(hanN) || spPatternToFourKinds("4");

        // Helper to set piece
        const set = (side, kind, fileChar, rankNum) => {
            const x = fileCharToX(fileChar);
            const y = 10 - rankNum;
            board[y][x] = side + kind;
        };

        // ----- 초(위쪽) 기본 배치 -----
        // 10랭크: 차, (b/c/g/h: 마/상 sp), 사, 장, 사
        set("초", "차", "a", 10);
        set("초", choPat[0], "b", 10);
        set("초", choPat[1], "c", 10);
        set("초", "사", "d", 10);
        set("초", "장", "e", 10);
        set("초", "사", "f", 10);
        set("초", choPat[2], "g", 10);
        set("초", choPat[3], "h", 10);
        set("초", "차", "i", 10);

        // 초 포: b8, h8
        set("초", "포", "b", 8);
        set("초", "포", "h", 8);

        // 초 졸: a7,c7,e7,g7,i7
        ["a", "c", "e", "g", "i"].forEach(f => set("초", "졸", f, 7));

        // ----- 한(아래쪽) 기본 배치 -----
        set("한", "차", "a", 1);
        set("한", hanPat[0], "b", 1);
        set("한", hanPat[1], "c", 1);
        set("한", "사", "d", 1);
        set("한", "장", "e", 1);
        set("한", "사", "f", 1);
        set("한", hanPat[2], "g", 1);
        set("한", hanPat[3], "h", 1);
        set("한", "차", "i", 1);

        // 한 포: b3, h3
        set("한", "포", "b", 3);
        set("한", "포", "h", 3);

        // 한 졸: a4,c4,e4,g4,i4
        ["a", "c", "e", "g", "i"].forEach(f => set("한", "졸", f, 4));

        return {
            board,
            meta: { sp: String(choN) + String(hanN) }
        };
    }

    // ---------------------------
    // PGN parsing (4 chars per ply)
    // ---------------------------
    function parseMoves(pgnStr) {
        const s = (pgnStr || "").trim();
        const out = [];
        if (!s) return out;

        if (s.length % 4 !== 0) {
            // continue parsing by truncating remainder
            appendMsg(`경고: pgn 길이가 4의 배수가 아닙니다. 마지막 ${s.length % 4}글자를 무시합니다.`);
        }

        const usableLen = s.length - (s.length % 4);
        for (let i = 0; i < usableLen; i += 4) {
            const raw = s.slice(i, i + 4);
            if (raw === "0000") {
                out.push({ raw, isPass: true, ok: true, from: null, to: null });
                continue;
            }

            const fromStr = raw.slice(0, 2);
            const toStr = raw.slice(2, 4);

            const from = coordToXY(fromStr);
            const to = coordToXY(toStr);

            const ok = from.ok && to.ok;
            out.push({
                raw,
                isPass: false,
                ok,
                from: from.ok ? { x: from.x, y: from.y, coord: fromStr } : null,
                to: to.ok ? { x: to.x, y: to.y, coord: toStr } : null,
                warn: ok ? null : `좌표 오류: ${raw} (${!from.ok ? from.reason : ""}${(!from.ok && !to.ok) ? ", " : ""}${!to.ok ? to.reason : ""})`
            });
        }
        return out;
    }

    // ---------------------------
    // Apply moves -> build snapshots
    // ---------------------------
    function buildSnapshots(initialBoard, parsedMoves) {
        const snaps = [];
        snaps.push({
            board: deepCopyBoard(initialBoard),
            lastMoveRaw: null,
            lastMove: null,
            warnings: [],
        });

        for (let i = 0; i < parsedMoves.length; i++) {
            const mv = parsedMoves[i];
            const prev = snaps[i];
            const nextBoard = deepCopyBoard(prev.board);

            const warnings = [];

            if (!mv.ok) {
                warnings.push(mv.warn || `알 수 없는 오류: ${mv.raw}`);
                snaps.push({
                    board: nextBoard,
                    lastMoveRaw: mv.raw,
                    lastMove: null,
                    warnings,
                });
                continue;
            }

            if (mv.isPass) {
                // 패스(0000): 하이라이트는 숨김(권장 요구사항)
                snaps.push({
                    board: nextBoard,
                    lastMoveRaw: mv.raw,
                    lastMove: { isPass: true },
                    warnings,
                });
                continue;
            }

            const { x: fx, y: fy } = mv.from;
            const { x: tx, y: ty } = mv.to;

            const piece = nextBoard[fy][fx];
            if (!piece) {
                warnings.push(`경고: ${mv.raw} 무시됨 — from(${mv.from.coord})에 말이 없습니다.`);
                snaps.push({
                    board: nextBoard,
                    lastMoveRaw: mv.raw,
                    lastMove: null,
                    warnings,
                });
                continue;
            }

            // capture allowed: to에 상대(혹은 같은 편) 말이 있으면 덮어쓰기 (규칙 검증 없음)
            nextBoard[fy][fx] = null;
            nextBoard[ty][tx] = piece;

            snaps.push({
                board: nextBoard,
                lastMoveRaw: mv.raw,
                lastMove: { isPass: false, from: { fx, fy }, to: { tx, ty } },
                warnings,
            });
        }

        return snaps;
    }

    // ---------------------------
    // Draw board lines/labels in SVG
    // ---------------------------
    function clearSvgLayer(layer) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
    }

    function svgEl(name, attrs = {}) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", name);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        return el;
    }

    function drawBoardSvg() {
        clearSvgLayer(gridLayer);
        clearSvgLayer(labelLayer);

        const { x, y, w, h } = INNER;
        const cellW = w / (FILES - 1); // 8 intervals
        const cellH = h / (RANKS - 1); // 9 intervals

        // grid lines
        for (let ix = 0; ix < FILES; ix++) {
            const xx = x + ix * cellW;
            gridLayer.appendChild(svgEl("line", {
                x1: xx, y1: y, x2: xx, y2: y + h,
                stroke: "rgba(0,0,0,0.88)",
                "stroke-width": 4,
                "stroke-linecap": "round"
            }));
        }
        for (let iy = 0; iy < RANKS; iy++) {
            const yy = y + iy * cellH;
            gridLayer.appendChild(svgEl("line", {
                x1: x, y1: yy, x2: x + w, y2: yy,
                stroke: "rgba(0,0,0,0.88)",
                "stroke-width": 4,
                "stroke-linecap": "round"
            }));
        }

        // palace diagonals
        // palace files: d,e,f => x indices 3,4,5
        // top palace ranks: 10,9,8 => y indices 0,1,2
        // bottom palace ranks: 1,2,3 => y indices 9,8,7
        function pt(ix, iy) {
            return { xx: x + ix * cellW, yy: y + iy * cellH };
        }

        // top: d10-e9-f8 and f10-e9-d8
        const d10 = pt(3, 0), e9 = pt(4, 1), f8 = pt(5, 2);
        const f10 = pt(5, 0), d8 = pt(3, 2);
        // bottom: d1-e2-f3 and f1-e2-d3
        const d1 = pt(3, 9), e2 = pt(4, 8), f3 = pt(5, 7);
        const f1 = pt(5, 9), d3 = pt(3, 7);

        const palaceLines = [
            [d10, e9], [e9, f8],
            [f10, e9], [e9, d8],
            [d1, e2], [e2, f3],
            [f1, e2], [e2, d3],
        ];

        palaceLines.forEach(([a, b]) => {
            gridLayer.appendChild(svgEl("line", {
                x1: a.xx, y1: a.yy, x2: b.xx, y2: b.yy,
                stroke: "rgba(0,0,0,0.88)",
                "stroke-width": 4,
                "stroke-linecap": "round"
            }));
        });

        // outer border emphasis around inner grid
        gridLayer.appendChild(svgEl("rect", {
            x, y, width: w, height: h,
            fill: "none",
            stroke: "rgba(0,0,0,0.55)",
            "stroke-width": 6,
            rx: 18, ry: 18
        }));

        // labels: files a..i (요구: 가로선 1~9 텍스트를 a~i로)
        // 보드 아래/위에 a..i를 표시 (가독성)
        const files = Array.from({ length: FILES }, (_, i) => String.fromCharCode(97 + i)); // a..i
        files.forEach((ch, ix) => {
            const { xx } = pt(ix, 0);
            // bottom label (under rank 1 line)
            labelLayer.appendChild(svgEl("text", {
                x: xx, y: y + h + 52,
                "text-anchor": "middle",
                "dominant-baseline": "middle",
                fill: "rgba(0,0,0,0.82)",
                "font-size": 34,
                "font-weight": 800
            })).textContent = ch;

            // top label
            labelLayer.appendChild(svgEl("text", {
                x: xx, y: y - 42,
                "text-anchor": "middle",
                "dominant-baseline": "middle",
                fill: "rgba(0,0,0,0.55)",
                "font-size": 26,
                "font-weight": 800
            })).textContent = ch;
        });
    }

    // ---------------------------
    // Layout + rendering
    // ---------------------------
    function computeLayout() {
        // boardWrap is sized by CSS aspect ratio trick (:before). We can read bounding box.
        const rect = boardWrap.getBoundingClientRect();

        // Convert INNER rect from SVG units -> CSS px
        const sx = rect.width / VIEW.w;
        const sy = rect.height / VIEW.h;

        layout.innerLeft = INNER.x * sx;
        layout.innerTop = INNER.y * sy;
        layout.innerW = INNER.w * sx;
        layout.innerH = INNER.h * sy;

        layout.cellW = layout.innerW / (FILES - 1);
        layout.cellH = layout.innerH / (RANKS - 1);

        const cellMin = Math.min(layout.cellW, layout.cellH);
        layout.pieceSize = cellMin * 0.78; // responsive
        layout.hlSize = cellMin * 0.62;
    }

    function xyToPixelCenter(x, y) {
        return {
            px: layout.innerLeft + x * layout.cellW,
            py: layout.innerTop + y * layout.cellH,
        };
    }

    function renderPieces(board) {
        pieceLayer.innerHTML = "";

        const frag = document.createDocumentFragment();
        for (let y = 0; y < RANKS; y++) {
            for (let x = 0; x < FILES; x++) {
                const code = board[y][x];
                if (!code) continue;

                const src = PIECE_IMG[code];
                // src missing is non-fatal
                const { px, py } = xyToPixelCenter(x, y);

                const img = document.createElement("img");
                img.className = "piece";
                img.alt = code;
                img.draggable = false;
                img.width = Math.round(layout.pieceSize);
                img.height = Math.round(layout.pieceSize);
                img.style.left = `${px}px`;
                img.style.top = `${py}px`;
                img.style.width = `${layout.pieceSize}px`;
                img.style.height = `${layout.pieceSize}px`;
                img.src = src || "";
                if (!src) {
                    img.style.opacity = "0.4";
                    img.title = `이미지 없음: ${code} (./assets/${code}.svg 확인)`;
                }

                frag.appendChild(img);
            }
        }
        pieceLayer.appendChild(frag);
    }

    function hideHighlights() {
        hlFrom.hidden = true;
        hlTo.hidden = true;
    }

    function renderHighlights(lastMove) {
        if (!lastMove || lastMove.isPass) {
            hideHighlights();
            return;
        }
        const { fx, fy } = lastMove.from;
        const { tx, ty } = lastMove.to;

        const a = xyToPixelCenter(fx, fy);
        const b = xyToPixelCenter(tx, ty);

        [hlFrom, hlTo].forEach(dot => {
            dot.style.width = `${layout.hlSize}px`;
            dot.style.height = `${layout.hlSize}px`;
        });

        hlFrom.style.left = `${a.px}px`;
        hlFrom.style.top = `${a.py}px`;
        hlTo.style.left = `${b.px}px`;
        hlTo.style.top = `${b.py}px`;

        hlFrom.hidden = false;
        hlTo.hidden = false;
    }

    function renderUI() {
        const total = Math.max(0, snapshots.length - 1);
        plyPill.textContent = `${ply}/${total}`;

        const snap = snapshots[ply];
        const mvRaw = snap?.lastMoveRaw;

        if (!mvRaw) {
            moveText.textContent = "-";
        } else if (mvRaw === "0000") {
            moveText.textContent = "0000 (패스)";
        } else {
            // pretty: e5→d5
            const from = mvRaw.slice(0, 2);
            const to = mvRaw.slice(2, 4);
            moveText.textContent = `${from}→${to}`;
        }

        // button enable/disable
        btnFirst.disabled = ply <= 0;
        btnPrev.disabled = ply <= 0;
        btnNext.disabled = ply >= total;
        btnLast.disabled = ply >= total;

        // message: show warnings at current ply
        const warnings = (snap && snap.warnings) ? snap.warnings : [];
        if (lastError) {
            showMsg(lastError);
        } else if (warnings.length) {
            showMsg(warnings.join("\n"));
        } else {
            showMsg("");
        }
    }

    function renderAll() {
        computeLayout();
        const snap = snapshots[ply];
        renderPieces(snap.board);
        renderHighlights(snap.lastMove);
        renderUI();
    }

    // ---------------------------
    // End badge mapping
    // ---------------------------
    function endToKorean(endVal) {
        const s = String(endVal || "").trim();
        if (!s) return null;
        const map = {
            "white-checkmate": "한(아래) 체크메이트",
            "black-checkmate": "초(위) 체크메이트",
            "checkmate": "체크메이트",
            "resign": "기권",
            "timewin": "시간승",
            "black-timewin": "초(위) 시간승",
            "white-timewin": "한(아래) 시간승",
            "draw": "무승부",
        };
        return map[s] || null;
    }

    function renderEndBadge(endVal) {
        if (!endVal) {
            endBadge.hidden = true;
            endBadge.textContent = "";
            return;
        }
        const ko = endToKorean(endVal);
        endBadge.hidden = false;
        endBadge.textContent = ko ? `${ko} · ${endVal}` : endVal;
    }

    // ---------------------------
    // Navigation
    // ---------------------------
    function goTo(nextPly) {
        const total = snapshots.length - 1;
        ply = clamp(nextPly, 0, total);
        renderAll();
    }

    function bindControls() {
        btnFirst.addEventListener("click", () => goTo(0));
        btnPrev.addEventListener("click", () => goTo(ply - 1));
        btnNext.addEventListener("click", () => goTo(ply + 1));
        btnLast.addEventListener("click", () => goTo(snapshots.length - 1));
        btnReload.addEventListener("click", () => bootFromUrl());

        window.addEventListener("keydown", (e) => {
            // iframe 내에서도 키가 들어오는 경우가 있어 간단 제공
            if (e.key === "ArrowLeft") goTo(ply - 1);
            if (e.key === "ArrowRight") goTo(ply + 1);
            if (e.key === "Home") goTo(0);
            if (e.key === "End") goTo(snapshots.length - 1);
        });
    }

    // ---------------------------
    // Boot from URL
    // ---------------------------
    function bootFromUrl() {
        lastError = null;
        showMsg("");

        const params = new URLSearchParams(location.search);
        const sp = (params.get("sp") || "44").trim();
        const pgn = (params.get("pgn") || "").trim();
        const end = (params.get("end") || "").trim();

        // Subtitle
        subtitle.textContent = `sp=${sp || "44"} · pgn=${pgn ? `${pgn.length} chars` : "없음"}`;

        // Validate sp
        const spOk = /^[1-4]{2}$/.test(sp);
        const usedSp = spOk ? sp : "44";
        if (!spOk) appendMsg(`경고: sp="${sp}" 형식 오류. 기본값 "44"를 사용합니다.`);

        // Parse moves
        moves = parseMoves(pgn);

        // Build snapshots
        const init = placeInitial(usedSp);
        snapshots = buildSnapshots(init.board, moves);

        // End badge
        renderEndBadge(end);

        // If pgn empty, show hint
        if (!pgn) {
            hintText.textContent = "pgn이 비어 있습니다. URL에 pgn을 넣으면 재생됩니다.";
        } else {
            hintText.textContent = "←/→ 키로도 이동 가능합니다.";
        }

        // Reset to start
        ply = 0;
        renderAll();
    }

    // ---------------------------
    // Resize observer
    // ---------------------------
    function watchResize() {
        const ro = new ResizeObserver(() => {
            // redraw only depends on layout; svg doesn't change.
            renderAll();
        });
        ro.observe(boardWrap);
    }

    // ---------------------------
    // Init
    // ---------------------------
    function init() {
        drawBoardSvg();
        bindControls();
        watchResize();
        bootFromUrl();
    }

    init();
})();
