const action =  {CONNECTED: 0, REFUSED: 1, JOIN: 2, LEAVE: 3, CURSOR: 4, SELECTION: 5, RESIZE_SELECTION: 6, OPERATION: 7, HIDE_CURSOR: 8, DRAW: 9, CHAT: 10, STATUS: 11};
const status_types = {ACTIVE: 0, IDLE: 1, AWAY: 2};
const libtextmode = require("../js/libtextmode/libtextmode");
let byte_count = 0;
let idle_timer, away_timer, status;
let ready = false;
const queued_events = [];

function set_status(ws, id, new_status) {
    status = new_status;
    ws.send(JSON.stringify({type: action.STATUS, data: {id, status}}));
}

function send(ws, type, data = {}) {
    ws.send(JSON.stringify({type, data}));
    if (status) set_status(ws, data.id, status_types.ACTIVE);
    if (idle_timer) clearTimeout(idle_timer);
    if (away_timer) clearTimeout(away_timer);
    idle_timer = setTimeout(() => {
        set_status(ws, data.id, status_types.IDLE);
        away_timer = setTimeout(() => set_status(ws, data.id, status_types.AWAY), 4 * 60 * 1000);
    }, 1 * 60 * 1000);
}

function queue(name, opts, network_handler) {
    if (ready) {
        network_handler[name](...opts);
    } else {
        queued_events.push({name, opts, network_handler});
    }
}

function message(ws, msg, network_handler) {
    byte_count += JSON.stringify(msg).length;
    // console.log(`${byte_count / 1024}kb received.`, msg.data);
    switch (msg.type) {
    case action.CONNECTED:
        const id = msg.data.id;
        status = msg.data.status;
        network_handler.connected({
            id,
            draw: (x, y, block) => {
                send(ws, action.DRAW, {id, x, y, block});
            },
            cursor: (x, y) => send(ws, action.CURSOR, {id, x, y}),
            selection: (x, y) => send(ws, action.SELECTION, {id, x, y}),
            resize_selection: (columns, rows) => send(ws, action.RESIZE_SELECTION, {id, columns, rows}),
            operation: (x, y) => send(ws, action.OPERATION, {id, x, y}),
            chat: (nick, group, text) => {
                send(ws, action.CHAT, {id, nick, group, text});
                network_handler.chat(id, nick, group, text);
            },
            status: (status) => send(ws, action.STATUS, {id, status}),
            hide_cursor: () => send(ws, action.HIDE_CURSOR, {id}),
            close: () => ws.close(),
            users: msg.data.users
        }, libtextmode.uncompress(msg.data.doc), msg.data.chat_history, msg.data.status);
        break;
    case action.REFUSED:
        network_handler.refused();
        break;
    case action.JOIN:
        queue("join", [msg.data.id, msg.data.nick, msg.data.group, msg.data.status], network_handler);
        break;
    case action.LEAVE:
        queue("leave", [msg.data.id], network_handler);
        break;
    case action.CURSOR:
        queue("cursor", [msg.data.id, msg.data.x, msg.data.y], network_handler);
        break;
    case action.SELECTION:
        queue("selection", [msg.data.id, msg.data.x, msg.data.y], network_handler);
        break;
    case action.RESIZE_SELECTION:
        queue("resize_selection", [msg.data.id, msg.data.columns, msg.data.rows], network_handler);
        break;
    case action.OPERATION:
        queue("operation", [msg.data.id, msg.data.x, msg.data.y], network_handler);
        break;
    case action.HIDE_CURSOR:
        queue("hide_cursor", [msg.data.id], network_handler);
        break;
    case action.DRAW:
        queue("draw", [msg.data.id, msg.data.x, msg.data.y, msg.data.block], network_handler);
        break;
    case action.CHAT:
        queue("chat", [msg.data.id, msg.data.nick, msg.data.group, msg.data.text], network_handler);
        break;
    case action.STATUS:
        queue("status", [msg.data.id, msg.data.status], network_handler);
        break;
    default:
        break;
    }
}

async function connect(ip, nick, group, pass, network_handler) {
    try {
        const ws = new WebSocket(`ws://${ip}:8000/`);
        ws.addEventListener("open", () => send(ws, action.CONNECTED, {nick, group, pass}));
        ws.addEventListener("error", network_handler.error);
        ws.addEventListener("close", network_handler.disconnected);
        ws.addEventListener("message", response => message(ws, JSON.parse(response.data), network_handler));
    } catch (err) {
        network_handler.error(err);
    }
}

function ready_to_receive_events() {
    for (const event of queued_events) event.network_handler[event.name](...event.opts);
    ready = true;
}

module.exports = {connect, ready_to_receive_events};
