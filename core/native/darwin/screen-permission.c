#include <CoreGraphics/CoreGraphics.h>
#include <node_api.h>

static napi_value request_screen_access(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value granted;
  if (napi_get_boolean(env, CGRequestScreenCaptureAccess(), &granted) != napi_ok) {
    return NULL;
  }
  return granted;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor request = {
    .utf8name = "requestScreenAccess",
    .method = request_screen_access,
  };
  if (napi_define_properties(env, exports, 1, &request) != napi_ok) {
    return NULL;
  }
  return exports;
}
