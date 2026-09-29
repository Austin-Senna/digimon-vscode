import * as fs from 'fs';

/**
 * Follows an append-only log that may not exist yet and may be rotated (renamed away and recreated).
 * Starts at the current end of the file: history is not replayed.
 */
export class LineTailer {
    private _offset = 0;
    private _inode = 0;
    private _remainder = Buffer.alloc(0);
    private readonly _timer: ReturnType<typeof setInterval>;

    constructor(private readonly _path: string,
        private readonly _onLine: (line: string) => void,
        intervalMs = 500,
    ) {
        try {
            const stats = fs.statSync(_path);
            this._offset = stats.size;
            this._inode = stats.ino;
        } catch {
            // Not created yet; the first write will be read from offset 0.
        }
        // Poll against our own offset rather than using fs.watchFile: watchFile diffs against a baseline it takes
        // asynchronously, so a write landing before that baseline would go unnoticed until the next write.
        this._timer = setInterval(() => this._poll(), intervalMs);
        this._timer.unref();
    }

    dispose(): void {
        clearInterval(this._timer);
    }

    private _poll(): void {
        let current: fs.Stats;
        try {
            current = fs.statSync(this._path);
        } catch {
            // Deleted or mid-rotation.
            this._reset(0);
            return;
        }
        if (current.ino !== this._inode || current.size < this._offset) {
            this._reset(current.ino);
        }
        if (current.size <= this._offset) {
            return;
        }
        const chunk = Buffer.alloc(current.size - this._offset);
        let fd: number | undefined;
        try {
            fd = fs.openSync(this._path, 'r');
            const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, this._offset);
            this._offset += bytesRead;
            this._emit(chunk.subarray(0, bytesRead));
        } catch {
            // Rotated between stat and open; the next poll sees the new inode and starts over.
        } finally {
            if (fd !== undefined) {
                fs.closeSync(fd);
            }
        }
    }

    private _emit(chunk: Buffer): void {
        let data = Buffer.concat([this._remainder, chunk]);
        let newline = data.indexOf(0x0a);
        while (newline !== -1) {
            const line = data.subarray(0, newline).toString('utf8').trim();
            if (line) {
                this._onLine(line);
            }
            data = data.subarray(newline + 1);
            newline = data.indexOf(0x0a);
        }
        this._remainder = Buffer.from(data);
    }

    private _reset(inode: number): void {
        this._offset = 0;
        this._inode = inode;
        this._remainder = Buffer.alloc(0);
    }
}
