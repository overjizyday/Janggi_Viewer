/* ============================================================
  장기 기보 뷰어 (정적 웹앱 / 외부 라이브러리 없음)

  [좌표 체계]
  - 파일(file): a~i (좌→우)
  - 랭크(rank): 1~10 (아래(한)→위(초))
    예) a1 = 좌하단, i10 = 우상단
  - 내부 인덱스:
    fileIndex: 0~8  (a=0, i=8)
    rankIndex: 0~9  (rank 1 => 0, rank 10 => 9)
  - 보드 픽셀 변환:
    9x10 격자 "교차점" 기준(장기판 스타일)로 배치
    x% = (fileIndex / 8) * 100
    y% = (1 - (rankIndex / 9)) * 100  // rank 1이 아래이므로 뒤집기

  [sp 변형 로직]
  sp = 두 자리 문자열, 예: "44"
   - 첫째 자리(1~4): 초(위)의 마/상 배치 유형
   - 둘째 자리(1~4): 한(아래)의 마/상 배치 유형
   - 의미:
     1 = 마상상마
     2 = 마상마상
     3 = 상마상마
     4 = 상마마상
  여기서 '마/상 4개 말'은 백랭크의 2~7 파일(b~g)에 놓이는 4칸:
    b,c,f,g (총 4개) 에 어떤 말(마/상)을 두느냐를 결정합니다.
    (차= a,i / 사= d,f? 등은 표준 유지)
  이 구현에서는 장기 표준 기준:
    - 한(아래) 백랭크: a1 차, b1? (마/상), c1? (마/상), d1 사, e1 장(왕), f1 사, g1? (마/상), h1? (마/상), i1 차
    - 초(위) 백랭크: a10 차, ... e10 장(왕) ...
  즉, b,c,g,h 파일에 마/상이 들어갑니다. (일반 장기 배치 관례를 따름)
  ※ 사용자 요구: "마/상 4개 말이 시작 배치에서 어느 파일에 놓이는지"를 sp로 결정.

  [PGN(간이) 스펙]
  - 4글자 = 한 수: from(2)+to(2)
    예) e5d5
  - "0000" = 패스. 이 경우 하이라이트는 숨김.
  - 규칙검증은 하지 않음(필수 아님).
    다만 from에 말이 없으면 그 수는 무시하고 경고를 띄움.
  - 캡처: to에 상대 말이 있으면 덮어써서 제거.
  - 되돌리기: 스냅샷 배열 방식(각 ply마다 보드 상태 전체 복사)으로 완벽 복구.

============================================================ */

(function () {
    const $ = (sel) => document.querySelector(sel);

    const boardEl = $("#board");
    const piecesLayer = $("#piecesLayer");
    const hlLayer = $("#hlLayer");
    const plyText = $("#plyText");
    const moveText = $("#moveText");
    const spText = $("#spText");
    const endBadge = $("#endBadge");
    const messageEl = $("#message");

    const btnFirst = $("#btnFirst");
    const btnPrev = $("#btnPrev");
    const btnNext = $("#btnNext");
    const btnLast = $("#btnLast");

    /** ---------- Utilities ---------- **/

    function showMessage(text, kind = "error") {
        if (!text) {
            messageEl.classList.add("hidden");
            messageEl.textContent = "";
            return;
        }
        messageEl.classList.remove("hidden");
        messageEl.textContent = text;
        // kind currently unused; style is "danger" by default
    }

    function parseParams() {
        const url = new URL(window.location.href);
        const sp = url.searchParams.get("sp") || "44";
        const pgn = url.searchParams.get("pgn") || "";
        const end = url.searchParams.get("end") || "";
        return { sp, pgn, end };
    }

    function isValidSp(sp) {
        return typeof sp === "string" && /^[1-4][1-4]$/.test(sp);
    }

    function fileCharToIndex(ch) {
        const code = ch.charCodeAt(0);
        const a = "a".charCodeAt(0);
        const i = "i".charCodeAt(0);
        if (code < a || code > i) return -1;
        return code - a;
    }

    function rankCharToIndex(ch1, ch2) {
        // rank can be 1~10. In pgn spec, rank is 1~10, expressed as "1".."10"
        // BUT our move encoding is fixed 2 chars per square => file + rankChar
        // That means rank must be single digit in encoding (1~9) would fit, but 10 doesn't.
        // However user spec says 2글자 좌표 and rank 1~10.
        // 해결: rank는 1~9는 '1'..'9', 10은 '0' 으로 인코딩한다고 가정하면 모호.
        // 사용자 스펙은 "2글자"를 강제하므로, 여기서는 다음 규칙을 채택:
        //   - '1'..'9' => 1..9
        //   - '0' => 10
        // 문서화: README에 명시.
        // 따라서 square = file + rankChar(1 char). (전체 2 chars)
        if (!ch1) return -1;
        if (ch1 >= "1" && ch1 <= "9") return (ch1.charCodeAt(0) - "1".charCodeAt(0)); // 1->0
        if (ch1 === "0") return 9; // 10 -> index 9
        return -1;
    }

    function squareToFR(sq) {
        // sq: 2 chars like "e5", "a0"(=a10)
        if (typeof sq !== "string" || sq.length !== 2) return null;
        const f = fileCharToIndex(sq[0]);
        const r = rankCharToIndex(sq[1]);
        if (f < 0 || r < 0) return null;
        return { f, r };
    }

    function frToSquare(f, r) {
        const file = String.fromCharCode("a".charCodeAt(0) + f);
        const rank = (r === 9) ? "0" : String(r + 1); // index 9 => 10 => '0'
        return file + rank;
    }

    function frToPercent(f, r) {
        // 교차점 기준 0~100%
        const x = (f / 8) * 100;
        const y = (1 - (r / 9)) * 100;
        return { x, y };
    }

    function deepCopyBoard(board) {
        // board is 10 rows x 9 cols (rankIndex 0..9, fileIndex 0..8)
        return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
    }

    /** ---------- Piece assets ---------- **/

    // piece object: { side: "han"|"cho", type: "cha|ma|sang|sa|jang|po|jol|byung" }
    // Note: user suggested cho_byung, han_jol etc.
    function pieceToAsset(p) {
        if (!p) return "";
        const side = p.side;
        const type = p.type;
        // map "jang" (king/general) asset: cho_jang.png / han_jang.png
        return `./assets/pieces/${side}_${type}.png`;
    }

    /** ---------- Initial setup ---------- **/

    function getMaSangPattern(n) {
        // n: 1..4
        // return array for [b,c,g,h] => types
        // 1=마상상마, 2=마상마상, 3=상마상마, 4=상마마상
        switch (n) {
            case 1: return ["ma", "sang", "sang", "ma"];
            case 2: return ["ma", "sang", "ma", "sang"];
            case 3: return ["sang", "ma", "sang", "ma"];
            case 4: return ["sang", "ma", "ma", "sang"];
            default: return ["sang", "ma", "ma", "sang"]; // fallback
        }
    }

    function makeEmptyBoard() {
        const board = [];
        for (let r = 0; r < 10; r++) {
            const row = new Array(9).fill(null);
            board.push(row);
        }
        return board;
    }

    function place(board, f, r, piece) {
        board[r][f] = piece;
    }

    function initPosition(sp) {
        // Standard Janggi-like placement per requirements:
        // - Back rank: cha at a/i, jang at e, sa at d/f, ma/sang at b/c/g/h (variant by sp)
        // - Po: cho at b8/h8, han at b3/h3
        // - Soldiers: cho byung at a7,c7,e7,g7,i7; han jol at a4,c4,e4,g4,i4
        const board = makeEmptyBoard();

        const choPattern = getMaSangPattern(parseInt(sp[0], 10));
        const hanPattern = getMaSangPattern(parseInt(sp[1], 10));

        // File indices
        const A = 0, B = 1, C = 2, D = 3, E = 4, F = 5, G = 6, H = 7, I = 8;

        // Ranks (index): rank 1 => 0, rank 10 => 9
        const R1 = 0, R3 = 2, R4 = 3, R7 = 6, R8 = 7, R10 = 9;

        // Han (bottom)
        place(board, A, R1, { side: "han", type: "cha" });
        place(board, I, R1, { side: "han", type: "cha" });
        // b,c,g,h per sp
        place(board, B, R1, { side: "han", type: hanPattern[0] });
        place(board, C, R1, { side: "han", type: hanPattern[1] });
        place(board, G, R1, { side: "han", type: hanPattern[2] });
        place(board, H, R1, { side: "han", type: hanPattern[3] });
        // palace pieces
        place(board, D, R1, { side: "han", type: "sa" });
        place(board, E, R1, { side: "han", type: "jang" });
        place(board, F, R1, { side: "han", type: "sa" });

        // Han cannons (po): b3/h3 => rank 3 index 2
        place(board, B, R3, { side: "han", type: "po" });
        place(board, H, R3, { side: "han", type: "po" });

        // Han soldiers (jol): a4,c4,e4,g4,i4 => rank4 index3
        [A, C, E, G, I].forEach(file => place(board, file, R4, { side: "han", type: "jol" }));

        // Cho (top)
        place(board, A, R10, { side: "cho", type: "cha" });
        place(board, I, R10, { side: "cho", type: "cha" });
        place(board, B, R10, { side: "cho", type: choPattern[0] });
        place(board, C, R10, { side: "cho", type: choPattern[1] });
        place(board, G, R10, { side: "cho", type: choPattern[2] });
        place(board, H, R10, { side: "cho", type: choPattern[3] });
        place(board, D, R10, { side: "cho", type: "sa" });
        place(board, E, R10, { side: "cho", type: "jang" });
        place(board, F, R10, { side: "cho", type: "sa" });

        // Cho cannons (po): b8/h8 => rank 8 index 7
        place(board, B, R8, { side: "cho", type: "po" });
        place(board, H, R8, { side: "cho", type: "po" });

        // Cho soldiers (byung): a7,c7,e7,g7,i7 => rank7 index6
        [A, C, E, G, I].forEach(file => place(board, file, R7, { side: "cho", type: "byung" }));

        return board;
    }

    /** ---------- PGN parsing ---------- **/

    function parsePgn(pgnRaw) {
        const pgn = (pgnRaw || "").trim();
        if (!pgn) return { moves: [], warnings: [] };

        // Must be multiple of 4 characters
        if (pgn.length % 4 !== 0) {
            return {
                moves: [],
                warnings: [`pgn 길이가 4의 배수가 아닙니다. (길이=${pgn.length})`],
                error: "pgn 파싱 실패: 길이 오류"
            };
        }

        const moves = [];
        const warnings = [];

        for (let i = 0; i < pgn.length; i += 4) {
            const chunk = pgn.slice(i, i + 4);
            const from = chunk.slice(0, 2);
            const to = chunk.slice(2, 4);

            if (chunk === "0000") {
                moves.push({ kind: "pass", raw: chunk });
                continue;
            }

            const fr = squareToFR(from);
            const tr = squareToFR(to);

            if (!fr || !tr) {
                warnings.push(`좌표 오류: "${chunk}" (from="${from}", to="${to}")`);
                moves.push({ kind: "invalid", raw: chunk, from, to });
                continue;
            }

            moves.push({
                kind: "move",
                raw: chunk,
                from,
                to,
                fr,
                tr
            });
        }

        return { moves, warnings };
    }

    /** ---------- Snapshot engine ---------- **/

    function applyMove(board, mv) {
        // returns { board, lastMove, warning? }
        // lastMove: {fromFR, toFR} for highlight
        if (mv.kind === "pass") {
            return { board, lastMove: null };
        }

        if (mv.kind !== "move") {
            return { board, lastMove: null, warning: `무시된 수: ${mv.raw}` };
        }

        const { fr, tr, from, to } = mv;
        const piece = board[fr.r][fr.f];

        if (!piece) {
            return { board, lastMove: null, warning: `경고: ${from}에 말이 없어 "${from}→${to}" 수를 무시했습니다.` };
        }

        // capture: overwrite destination
        const next = deepCopyBoard(board);
        next[tr.r][tr.f] = piece;
        next[fr.r][fr.f] = null;

        return { board: next, lastMove: { fr, tr, raw: `${from}→${to}` } };
    }

    function buildSnapshots(initialBoard, moves) {
        // snapshots[0] = initial
        // snapshots[k] = after k plies
        const snapshots = [deepCopyBoard(initialBoard)];
        const meta = [{ lastMove: null, raw: "-" }];
        const warnings = [];

        let current = deepCopyBoard(initialBoard);

        for (let i = 0; i < moves.length; i++) {
            const mv = moves[i];
            const res = applyMove(current, mv);
            current = res.board;

            snapshots.push(deepCopyBoard(current));
            meta.push({
                lastMove: res.lastMove,
                raw: mv.kind === "pass" ? "패스(0000)" :
                    (mv.kind === "move" ? (res.lastMove ? res.lastMove.raw : mv.raw) : `무효(${mv.raw})`)
            });

            if (res.warning) warnings.push(res.warning);
        }

        return { snapshots, meta, warnings };
    }

    /** ---------- Rendering ---------- **/

    function clearLayer(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function renderPieces(board) {
        clearLayer(piecesLayer);

        for (let r = 0; r < 10; r++) {
            for (let f = 0; f < 9; f++) {
                const p = board[r][f];
                if (!p) continue;

                const img = document.createElement("img");
                img.className = "piece";
                img.alt = `${p.side} ${p.type}`;
                img.draggable = false;
                img.loading = "eager";
                img.src = pieceToAsset(p);

                const { x, y } = frToPercent(f, r);
                img.style.left = `${x}%`;
                img.style.top = `${y}%`;

                // If image missing, show a simple fallback via onerror
                img.onerror = () => {
                    img.onerror = null;
                    img.removeAttribute("src");
                    img.style.width = "10.5%";
                    img.style.height = "10.5%";
                    img.style.borderRadius = "999px";
                    img.style.background = "rgba(0,0,0,0.25)";
                    img.style.border = "1px solid rgba(255,255,255,0.22)";
                    img.style.display = "grid";
                    img.style.placeItems = "center";
                    img.style.fontSize = "11px";
                    img.style.color = "rgba(255,255,255,0.9)";
                    img.style.fontWeight = "800";
                    img.style.textShadow = "0 1px 4px rgba(0,0,0,0.35)";
                    img.style.padding = "2px";
                    img.title = "이미지 누락";
                    img.alt = "이미지 누락";
                    // Use data- fallback text by replacing with a div-like trick:
                    // simplest: keep img but add a sibling label
                    const label = document.createElement("div");
                    label.style.position = "absolute";
                    label.style.left = img.style.left;
                    label.style.top = img.style.top;
                    label.style.transform = "translate(-50%,-50%)";
                    label.style.width = "10.5%";
                    label.style.aspectRatio = "1/1";
                    label.style.borderRadius = "999px";
                    label.style.background = "rgba(0,0,0,0.22)";
                    label.style.border = "1px solid rgba(255,255,255,0.20)";
                    label.style.display = "grid";
                    label.style.placeItems = "center";
                    label.style.fontSize = "11px";
                    label.style.fontWeight = "800";
                    label.style.color = "rgba(255,255,255,0.92)";
                    label.style.textShadow = "0 1px 4px rgba(0,0,0,0.35)";
                    label.textContent = `${p.side[0].toUpperCase()}-${p.type}`;
                    piecesLayer.appendChild(label);
                    img.style.display = "none";
                };

                piecesLayer.appendChild(img);
            }
        }
    }

    function renderHighlight(lastMove) {
        clearLayer(hlLayer);
        if (!lastMove) return;

        const { fr, tr } = lastMove;

        const a = document.createElement("div");
        a.className = "hl";
        const b = document.createElement("div");
        b.className = "hl";

        const p1 = frToPercent(fr.f, fr.r);
        const p2 = frToPercent(tr.f, tr.r);

        a.style.left = `${p1.x}%`;
        a.style.top = `${p1.y}%`;
        b.style.left = `${p2.x}%`;
        b.style.top = `${p2.y}%`;

        hlLayer.appendChild(a);
        hlLayer.appendChild(b);
    }

    /** ---------- End badge ---------- **/

    function endToKorean(end) {
        // 예시: "white-checkmate", "black-timewin", "resign"
        const map = {
            "white-checkmate": "한 승(체크메이트)",
            "black-checkmate": "초 승(체크메이트)",
            "white-timewin": "한 승(시간승)",
            "black-timewin": "초 승(시간승)",
            "resign": "기권",
            "draw": "무승부"
        };
        return map[end] || null;
    }

    /** ---------- App state ---------- **/

    let state = {
        sp: "44",
        moves: [],
        snapshots: [],
        meta: [],
        cursor: 0 // current ply (0..total)
    };

    function setCursor(ply) {
        const total = state.snapshots.length ? state.snapshots.length - 1 : 0;
        const clamped = Math.max(0, Math.min(total, ply));
        state.cursor = clamped;
        render();
    }

    function render() {
        const total = state.snapshots.length ? state.snapshots.length - 1 : 0;
        const cur = state.cursor;

        plyText.textContent = `${cur}/${total}`;
        const meta = state.meta[cur] || { lastMove: null, raw: "-" };
        moveText.textContent = meta.raw || "-";

        const board = state.snapshots[cur] || makeEmptyBoard();
        renderHighlight(meta.lastMove); // pass => null => 숨김
        renderPieces(board);

        btnFirst.disabled = (cur === 0);
        btnPrev.disabled = (cur === 0);
        btnNext.disabled = (cur === total);
        btnLast.disabled = (cur === total);
    }

    /** ---------- Bootstrap ---------- **/

    function init() {
        const { sp, pgn, end } = parseParams();

        // sp
        const fixedSp = isValidSp(sp) ? sp : "44";
        state.sp = fixedSp;
        spText.textContent = `sp: ${fixedSp}`;
        if (!isValidSp(sp) && sp) {
            showMessage(`sp 값이 올바르지 않아 "44"로 대체했습니다. (입력=${sp})`);
        } else {
            showMessage("");
        }

        // end
        if (end) {
            const ko = endToKorean(end);
            endBadge.classList.remove("hidden");
            endBadge.textContent = ko ? `결과: ${ko}` : `결과: ${end}`;
            endBadge.title = end;
        } else {
            endBadge.classList.add("hidden");
        }

        // pgn
        const parsed = parsePgn(pgn);
        state.moves = parsed.moves || [];

        const initialBoard = initPosition(fixedSp);
        const built = buildSnapshots(initialBoard, state.moves);
        state.snapshots = built.snapshots;
        state.meta = built.meta;

        const warnings = []
            .concat(parsed.warnings || [])
            .concat(built.warnings || []);

        if (parsed.error) {
            showMessage(parsed.error + (warnings.length ? "\n" + warnings.join("\n") : ""));
        } else if (warnings.length) {
            // 너무 길면 일부만
            const max = 8;
            const head = warnings.slice(0, max);
            const more = warnings.length > max ? `\n...외 ${warnings.length - max}개` : "";
            showMessage(head.join("\n") + more);
        }

        // wire buttons
        btnFirst.addEventListener("click", () => setCursor(0));
        btnPrev.addEventListener("click", () => setCursor(state.cursor - 1));
        btnNext.addEventListener("click", () => setCursor(state.cursor + 1));
        btnLast.addEventListener("click", () => setCursor((state.snapshots.length ? state.snapshots.length - 1 : 0)));

        // keyboard support
        window.addEventListener("keydown", (e) => {
            if (e.key === "ArrowLeft") setCursor(state.cursor - 1);
            if (e.key === "ArrowRight") setCursor(state.cursor + 1);
            if (e.key === "Home") setCursor(0);
            if (e.key === "End") setCursor((state.snapshots.length ? state.snapshots.length - 1 : 0));
        });

        // initial render
        setCursor(0);
    }

    init();
})();
