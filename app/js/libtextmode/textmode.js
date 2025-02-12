function bytes_to_blocks({columns, rows, bytes}) {
    const data = new Array(columns * rows);
    for (let i = 0, j = 0; i < data.length; i++, j++) {
        data[i] = {code: bytes[j++], bg: bytes[j] >> 4, fg: bytes[j] & 0xf};
    }
    return data;
}

class Sauce {
    constructor({columns, rows, title = "", author = "", group = "", date, filesize = 0, ice_colors = false, use_9px_font = false, font_name = "IBM VGA", comments = []} = {}) {
        this.columns = columns;
        this.rows = rows;
        this.title = title;
        this.author = author;
        this.group = group;
        this.date = date;
        this.filesize = filesize;
        this.ice_colors = ice_colors;
        this.use_9px_font = use_9px_font;
        this.font_name = font_name;
        this.comments = comments;
    }
}

function add_text(bytes, pos, text, max_length) {
    for (let i = 0; i < max_length; i += 1) {
        if (i < text.length) {
            bytes[pos + i] = text.charCodeAt(i);
        } else {
            bytes[pos + i] = 32;
        }
    }
}

function current_date() {
    const date = new Date();
    const year = date.getFullYear().toString(10);
    const month = (date.getMonth() + 1).toString(10).padStart(2, "0");
    const day = date.getDate().toString(10).padStart(2, "0");
    return `${year}${month}${day}`;
}

const data_type_types = {CHARACTER: 1, BIN: 5, XBIN: 6};
const file_type_types = {NONE: 0, ANS_FILETYPE: 1};

function add_comments_bytes(comments, sauce_bytes) {
    const bytes = new Uint8Array(5 + comments.length * 64);
    add_text(bytes, 0, "COMNT", 5);
    for (let i = 0; i < comments.length; i++) {
        add_text(bytes, i * 64 + 5, comments[i], 64);
    }
    const merged_bytes = new Int8Array(bytes.length + sauce_bytes.length);
    merged_bytes.set(bytes, 0);
    merged_bytes.set(sauce_bytes, bytes.length);
    return merged_bytes;
}

function add_sauce_bytes({doc, data_type, file_type, bytes: file_bytes}) {
    let bytes = new Uint8Array(128);
    add_text(bytes, 0, "SAUCE00", 7);
    add_text(bytes, 7, doc.title, 35);
    add_text(bytes, 42, doc.author, 20);
    add_text(bytes, 62, doc.group, 20);
    add_text(bytes, 82, current_date(), 8);
    bytes[90] = file_bytes.length & 0xff;
    bytes[91] = (file_bytes.length >> 8) & 0xff;
    bytes[92] = (file_bytes.length >> 16) & 0xff;
    bytes[93] = file_bytes.length >> 24;
    bytes[94] = data_type;
    if (data_type == data_type_types.BIN) {
        bytes[95] = doc.columns / 2;
    } else {
        bytes[95] = file_type;
        bytes[96] = doc.columns & 0xff;
        bytes[97] = doc.columns >> 8;
        bytes[98] = doc.rows & 0xff;
        bytes[99] = doc.rows >> 8;
    }
    bytes[104] = doc.comments.length;
    if (data_type != data_type_types.XBIN) {
        if (doc.ice_colors) {
            bytes[105] = 1;
        }
        if (doc.use_9px_font) {
            bytes[105] += 1 << 2;
        } else {
            bytes[105] += 1 << 1;
        }
        if (doc.font_name) {
            add_text(bytes, 106, doc.font_name, doc.font_name.length);
        }
    }
    if (doc.comments.length) {
        bytes = add_comments_bytes(doc.comments, bytes);
    }
    const merged_bytes = new Int8Array(file_bytes.length + 1 + bytes.length);
    merged_bytes.set(file_bytes, 0);
    merged_bytes[file_bytes.length] = 27;
    merged_bytes.set(bytes, file_bytes.length + 1);
    return merged_bytes;
}

function add_sauce_for_ans({doc, bytes}) {
    return add_sauce_bytes({doc, data_type: data_type_types.CHARACTER, file_type: file_type_types.ANS_FILETYPE, bytes});
}

function add_sauce_for_bin({doc, bytes}) {
    return add_sauce_bytes({doc, data_type: data_type_types.BIN, file_type: file_type_types.NONE, bytes});
}

function add_sauce_for_xbin({doc, bytes}) {
    return add_sauce_bytes({doc, data_type: data_type_types.XBIN, file_type: file_type_types.NONE, bytes});
}

function bytes_to_string(bytes, offset, size) {
    return String.fromCharCode.apply(null, bytes.subarray(offset, offset + size)).trim();
}

function get_sauce(bytes) {
    if (bytes.length >= 128) {
        const sauce_bytes = bytes.slice(-128);
        if (bytes_to_string(sauce_bytes, 0, 5) == "SAUCE" && bytes_to_string(sauce_bytes, 5, 2) == "00") {
            const title = bytes_to_string(sauce_bytes, 7, 35);
            const author = bytes_to_string(sauce_bytes, 42, 20);
            const group = bytes_to_string(sauce_bytes, 62, 20);
            const date = bytes_to_string(sauce_bytes, 82, 8);
            let filesize = (sauce_bytes[93] << 24) + (sauce_bytes[92] << 16) + (sauce_bytes[91] << 8) + sauce_bytes[90];
            const datatype = sauce_bytes[94];
            let columns, rows;
            if (datatype === 5) {
                columns = sauce_bytes[95] * 2;
                rows = filesize / columns / 2;
            } else {
                columns = (sauce_bytes[97] << 8) + sauce_bytes[96];
                rows = (sauce_bytes[99] << 8) + sauce_bytes[98];
            }
            const number_of_comments = sauce_bytes[104];
            const comments = new Array(number_of_comments);
            if (number_of_comments) {
                const comments_bytes = bytes.subarray(bytes.length - (number_of_comments * 64 + 5) - 128, bytes.length - 128);
                if (bytes_to_string(comments_bytes, 0, 5) == "COMNT") {
                    for (let i = 0; i < number_of_comments; i++) {
                        comments[i] = bytes_to_string(comments_bytes, 5 + i * 64, 64);
                    }
                } else {
                    raise("Error parsing SAUCE file: missing comments.");
                }
            }
            const flags = sauce_bytes[105];
            const ice_colors = (flags & 0x01) == 1;
            const use_9px_font = (flags >> 1 & 0x02) == 2;
            let font_name = bytes_to_string(sauce_bytes, 106, 22).replace(/\0/g, "");
            if (font_name == "") {
                font_name = "IBM VGA";
            }
            if (filesize == 0) {
                filesize = bytes.length = 128;
                if (number_of_comments) {
                    filesize -= number_of_comments * 64 + 5;
                }
            }
            return new Sauce({columns, rows, title, author, group, date, filesize, ice_colors, use_9px_font, font_name, comments});
        }
    }
    const sauce = new Sauce();
    sauce.filesize = bytes.length;
    return sauce;
}

class Textmode {
    constructor(bytes) {
        const sauce = get_sauce(bytes);
        this.columns = sauce.columns;
        this.rows = sauce.rows;
        this.title = sauce.title;
        this.author = sauce.author;
        this.group = sauce.group;
        this.date = sauce.date;
        this.filesize = sauce.filesize;
        this.ice_colors = sauce.ice_colors;
        this.use_9px_font = sauce.use_9px_font;
        this.font_name = sauce.font_name;
        this.comments = sauce.comments;
        this.bytes = bytes.subarray(0, this.filesize);
    }
}

function resize_canvas(doc, columns, rows) {
    const min_rows = Math.min(doc.rows, rows);
    const min_columns = Math.min(doc.columns, columns);
    const new_data = new Array(columns * rows);
    for (let i = 0; i < new_data.length; i++) {
        new_data[i] = ({code: 32, fg: 7, bg: 0});
    }
    for (let y = 0; y < min_rows; y++) {
        for (let x = 0; x < min_columns; x++) {
            new_data[y * columns + x] = doc.data[y * doc.columns + x];
        }
    }
    doc.data = new_data;
    doc.columns = columns;
    doc.rows = rows;
}

module.exports = {bytes_to_blocks, bytes_to_string, current_date, Textmode, add_sauce_for_ans, add_sauce_for_bin, add_sauce_for_xbin, resize_canvas};
