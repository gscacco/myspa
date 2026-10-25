/** Separate EDN file import and export, following the project's browser picker pattern. */

const FILE_TYPES = [{ description: 'Loom knowledge base (EDN)', accept: { 'application/edn': ['.edn'] } }];

export function createEDNFileIO({ window, document }) {
  function download(source, filename) {
    const url = window.URL.createObjectURL(new window.Blob([source], { type: 'application/edn;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  async function save(source, filename = 'loom.edn') {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: filename, types: FILE_TYPES });
        const writer = await handle.createWritable();
        await writer.write(source); await writer.close();
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    download(source, filename);
    return true;
  }

  async function choose() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
        return await handle.getFile();
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        throw error;
      }
    }
    const input = document.querySelector('#edn-file');
    if (!input) throw new Error('The EDN file input is unavailable');
    input.value = '';
    return new Promise(resolve => {
      const finish = file => { input.removeEventListener('change', changed); input.removeEventListener('cancel', cancelled); resolve(file); };
      const changed = () => finish(input.files?.[0] || null);
      const cancelled = () => finish(null);
      input.addEventListener('change', changed);
      input.addEventListener('cancel', cancelled);
      input.click();
    });
  }

  return { save, choose };
}
