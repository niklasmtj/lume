import {
  join,
  dirname,
  basename,
  extname,
} from "./deps/path.js";
import { existsSync } from "./deps/fs.js";
import { Directory, Page } from "./filesystem.js";

export default class Source {
  root = new Directory({ path: "/" });

  data = new Map();
  pages = new Map();
  staticFiles = new Map();
  assets = new Set();

  constructor(path) {
    this.path = path;
  }

  /**
   * Returns the Directory instance of a path
   */
  getDirectory(path, create = false) {
    let dir = this.root;

    path.split("/").forEach((name) => {
      if (!name || !dir) {
        return;
      }

      if (create && !dir.dirs.has(name)) {
        dir.createDirectory(name);
      }

      dir = dir.dirs.get(name);
    });

    return dir;
  }

  /**
   * Check whether a file is included in the static files
   */
  isStatic(file) {
    for (const entry of this.staticFiles) {
      const [from] = entry;

      if (file.startsWith(from)) {
        return entry;
      }
    }

    return false;
  }

  /**
   * Load a directory recursively
   */
  async loadDirectory(directory = this.root) {
    const path = join(this.path, directory.src.path);

    for (const entry of Deno.readDirSync(path)) {
      await this.#loadEntry(directory, entry);
    }
  }

  /**
   * Reload some files
   */
  async loadFile(file) {
    const entry = {
      name: basename(file),
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    };

    //Is a file inside _data folder
    if (file.match(/\/_data\//)) {
      const dir = file.split("/_data/", 2).shift();
      const directory = this.getDirectory(dir, true);
      return this.#loadDataFolderEntry(
        join(directory.src.path, "_data"),
        entry,
        directory.data,
      );
    }

    const directory = this.getDirectory(dirname(file), true);
    await this.#loadEntry(directory, entry);
  }

  /**
   * Load an entry from a directory
   */
  async #loadEntry(directory, entry) {
    if (entry.isSymlink || entry.name.startsWith(".")) {
      return;
    }

    const path = join(directory.src.path, entry.name);

    if (this.staticFiles.has(path)) {
      return;
    }

    if (entry.isDirectory && entry.name === "_data") {
      directory.data = await this.#loadDataFolder(path);
      return;
    }

    if (entry.isFile && entry.name.match(/^_data\.\w+$/)) {
      directory.data = await this.#loadData(path);
      return;
    }

    if (entry.name.startsWith("_")) {
      return;
    }

    if (entry.isFile) {
      const page = await this.#loadPage(path);

      if (page) {
        directory.setPage(entry.name, page);
      }
      return;
    }

    if (entry.isDirectory) {
      const subDirectory = directory.createDirectory(entry.name);
      await this.loadDirectory(subDirectory);
      return;
    }
  }

  /**
   * Create and returns a Page
   */
  async #loadPage(path) {
    let ext, load;

    for (const [key, value] of this.pages) {
      if (path.endsWith(key)) {
        ext = key;
        load = value;
        break;
      }
    }

    if (!load) {
      return;
    }

    const fullPath = join(this.path, path);

    if (!existsSync(fullPath)) {
      return;
    }

    const info = await Deno.stat(fullPath);
    const src = {
      path: path.slice(0, -ext.length),
      lastModified: info.mtime,
      created: info.birthtime,
      ext,
    };

    const page = new Page(src);
    page.data = await load(fullPath);

    page.dest.path = page.src.path;
    page.dest.ext = this.assets.has(ext) ? ext : ".html";

    if (!page.data.date) {
      page.data.date = page.src.created || page.src.lastModified;
    } else if (!(page.data.date instanceof Date)) {
      throw new Error(
        'Invalid date. Use "yyyy-mm-dd" or "yyy-mm-dd hh:mm:ss" formats',
      );
    }

    return page;
  }

  /**
   * Load a _data.* file and return the content
   */
  async #loadData(path) {
    for (const [ext, loader] of this.data) {
      if (path.endsWith(ext)) {
        return loader(join(this.path, path));
      }
    }
  }

  /**
   * Load a _data folder and return the content of all files
   */
  async #loadDataFolder(path) {
    const data = {};

    for (const entry of Deno.readDirSync(join(this.path, path))) {
      await this.#loadDataFolderEntry(path, entry, data);
    }

    return data;
  }

  /**
   * Load a data file inside a _data folder
   */
  async #loadDataFolderEntry(path, entry, data) {
    if (
      entry.isSymlink || entry.name.startsWith(".") ||
      entry.name.startsWith("_")
    ) {
      return;
    }

    if (entry.isFile) {
      const name = basename(entry.name, extname(entry.name));
      data[name] = Object.assign(
        data[name] || {},
        await this.#loadData(join(path, entry.name)),
      );
      return;
    }

    if (entry.isDirectory) {
      data[entry.name] = await this.#loadDataFolder(join(path, entry.name));
    }
  }
}
