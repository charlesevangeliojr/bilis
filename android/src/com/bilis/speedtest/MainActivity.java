package com.bilis.speedtest;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Minimal Android shell. All measurements run through the live Bilis site. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://bilis.infinityfree.me/";
    private WebView browser;
    private ProgressBar progress;
    private LinearLayout errorPanel;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(25, 44, 37));
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
          @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
          }
        });
        setContentView(root);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        browser = new WebView(this);
        root.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " BilisAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value < 100 ? View.VISIBLE : View.GONE);
            }
        });
        browser.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                // Older deployed pages also understand this installation event.
                view.evaluateJavascript("window.dispatchEvent(new Event('appinstalled'));", null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutside(Uri.parse(url));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
        });
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        TextView message = new TextView(this);
        message.setText("Bilis couldn’t connect.\nCheck your internet connection and try again.");
        message.setTextColor(Color.WHITE);
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        errorPanel.addView(message);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { loadHome(); }
        });
        errorPanel.addView(retry);
        root.addView(errorPanel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        errorPanel.setVisibility(View.GONE);
        loadHome();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void loadHome() {
        errorPanel.setVisibility(View.GONE);
        browser.setVisibility(View.VISIBLE);
        browser.loadUrl(HOME);
    }
    private void showError() {
        browser.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }
    private boolean openOutside(Uri uri) {
        if ("https".equals(uri.getScheme()) && "bilis.infinityfree.me".equals(uri.getHost())) return false;
        if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (android.content.ActivityNotFoundException ignored) {}
        }
        return true;
    }
    @Override public void onBackPressed() {
        if (browser.getVisibility() == View.VISIBLE && browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }
    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        browser.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (browser != null) browser.onResume();
    }
    @Override protected void onDestroy() {
        browser.stopLoading();
        ((ViewGroup) browser.getParent()).removeView(browser);
        browser.destroy();
        super.onDestroy();
    }
}
