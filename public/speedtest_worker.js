'use strict';
// Keep upstream files unmodified. Convert HTTP failures into stream errors;
// upstream's download and ping handlers otherwise accept error-page bodies.
const NativeXHR = self.XMLHttpRequest;
self.XMLHttpRequest = class extends NativeXHR {
  send(body) {
    let rejected = false;
    this.addEventListener('readystatechange', () => {
      if (rejected || this.readyState !== 2) return;
      const invalidDownload = this.responseType === 'arraybuffer' &&
        !(this.getResponseHeader('Content-Type') || '').includes('application/octet-stream');
      if (this.status < 400 && !invalidDownload) return;
      rejected = true;
      const reason = this.status >= 400 ? `Test server returned HTTP ${this.status}. Please try again.` : 'The test server returned an invalid download response.';
      self.postMessage(JSON.stringify({ testState: 5, error: reason }));
      const failure = this.onerror || this.upload.onerror;
      this.onload = null;
      this.onprogress = null;
      this.upload.onprogress = null;
      this.upload.onload = null;
      this.abort();
      if (failure) failure.call(this, new Event('error'));
    });
    super.send(body);
  }
};
importScripts('vendor/librespeed/speedtest_worker.js');
