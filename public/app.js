(function bootstrap() {
  const config = window.APP_CONFIG || {};
  const connectBtn = document.getElementById("connectBtn");
  const statusEl = document.getElementById("status");
  const debugEl = document.getElementById("debug");

  function setStatus(message, level) {
    statusEl.textContent = message;
    statusEl.className = `status ${level || "info"}`;
  }

  function setDebug(payload) {
    debugEl.textContent = JSON.stringify(payload, null, 2);
  }

  function hasValidConfig() {
    return Boolean(config.appId && config.configId && config.redirectUri);
  }

  function loadMetaSdk() {
    return new Promise((resolve, reject) => {
      if (window.FB) {
        resolve();
        return;
      }

      window.fbAsyncInit = function fbAsyncInit() {
        window.FB.init({
          appId: config.appId,
          cookie: false,
          xfbml: false,
          version: config.graphVersion || "v21.0",
        });

        resolve();
      };

      const sdkScript = document.createElement("script");
      sdkScript.src = "https://connect.facebook.net/en_US/sdk.js";
      sdkScript.async = true;
      sdkScript.defer = true;
      sdkScript.crossOrigin = "anonymous";

      sdkScript.onerror = function onSdkError() {
        reject(new Error("Meta JS SDK konnte nicht geladen werden."));
      };

      document.head.appendChild(sdkScript);
    });
  }

  function buildCallbackUrl(code, state) {
    const callbackUrl = new URL(config.redirectUri);
    callbackUrl.searchParams.set("code", code);
    if (state) {
      callbackUrl.searchParams.set("state", state);
    }
    return callbackUrl.toString();
  }

  function startEmbeddedSignup() {
    if (!window.FB) {
      setStatus("Meta SDK ist noch nicht bereit. Bitte kurz erneut versuchen.", "warn");
      return;
    }

    setStatus("Meta Popup wird geoeffnet…", "info");

    const flowState = `coexistence-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const loginOptions = {
      config_id: config.configId,
      response_type: "code",
      override_default_response_type: true,
      scope: config.scopes || "business_management,whatsapp_business_management",
      state: flowState,
    };

    setDebug({
      step: "FB.login",
      options: loginOptions,
      redirect_uri: config.redirectUri,
    });

    window.FB.login(
      function onLogin(response) {
        if (!response || response.status === "unknown") {
          setStatus("Login wurde abgebrochen oder blockiert.", "warn");
          setDebug({ step: "callback", response });
          return;
        }

        const code = response.authResponse && response.authResponse.code;

        if (!code) {
          setStatus(
            "Kein Authorization Code erhalten. Pruefe, ob die Login-for-Business Configuration ID korrekt ist.",
            "error"
          );
          setDebug({ step: "callback_without_code", response });
          return;
        }

        const redirectTo = buildCallbackUrl(code, response.authResponse.state);
        setStatus("Code erhalten. Weiterleitung zum Server Callback…", "ok");
        setDebug({ step: "redirect", redirect_to: redirectTo });

        window.location.assign(redirectTo);
      },
      loginOptions
    );
  }

  async function init() {
    setDebug({
      appId: config.appId || null,
      configId: config.configId || null,
      redirectUri: config.redirectUri || null,
      graphVersion: config.graphVersion || null,
      scopes: config.scopes || null,
      missingEnvVars: config.missingEnvVars || [],
    });

    if (!hasValidConfig()) {
      connectBtn.disabled = true;
      setStatus(
        "Server-Konfiguration unvollstaendig. Bitte .env ausfuellen und Server neu starten.",
        "error"
      );
      return;
    }

    if (Array.isArray(config.missingEnvVars) && config.missingEnvVars.length > 0) {
      connectBtn.disabled = true;
      setStatus(
        `Fehlende .env Variablen: ${config.missingEnvVars.join(", ")}`,
        "error"
      );
      return;
    }

    try {
      await loadMetaSdk();
      setStatus("Meta SDK bereit. Du kannst den Signup starten.", "ok");
      connectBtn.disabled = false;
    } catch (error) {
      connectBtn.disabled = true;
      setStatus(error.message || "Meta SDK konnte nicht geladen werden.", "error");
    }
  }

  connectBtn.addEventListener("click", startEmbeddedSignup);
  connectBtn.disabled = true;
  init();
})();
