#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <node_api.h>

#define SIGN_IN_CACHE_NAME "Recordly Sign-in Cache"

enum { KEY_BYTES = 32 };

static CFMutableDictionaryRef key_query(void) {
	CFMutableDictionaryRef query = CFDictionaryCreateMutable(
		NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
	CFDictionarySetValue(query, kSecAttrService, CFSTR("dev.recordly.app.saved-sign-in"));
	CFDictionarySetValue(query, kSecAttrAccount, CFSTR("encryption-key"));
	return query;
}

static napi_value keychain_error(napi_env env) {
	napi_throw_error(env, NULL, SIGN_IN_CACHE_NAME " is unavailable in Keychain.");
	return NULL;
}

static napi_value read_key(napi_env env, napi_callback_info info) {
	(void)info;
	CFMutableDictionaryRef query = key_query();
	CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
	CFTypeRef item = NULL;
	OSStatus status = SecItemCopyMatching(query, &item);
	CFRelease(query);
	napi_value result;
	if (status == errSecItemNotFound)
		return napi_get_null(env, &result) == napi_ok ? result : keychain_error(env);
	if (status != errSecSuccess || !item)
		return keychain_error(env);
	napi_status copied = napi_generic_failure;
	if (CFGetTypeID(item) == CFDataGetTypeID() && CFDataGetLength(item) == KEY_BYTES)
		copied = napi_create_buffer_copy(env, KEY_BYTES, CFDataGetBytePtr(item), NULL, &result);
	CFRelease(item);
	return copied == napi_ok ? result : keychain_error(env);
}

static napi_value add_key(napi_env env, napi_callback_info info) {
	size_t argc = 1, length = 0;
	napi_value arg;
	void *bytes;
	if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1 ||
		napi_get_buffer_info(env, arg, &bytes, &length) != napi_ok || length != KEY_BYTES) {
		napi_throw_type_error(env, NULL, "Invalid saved sign-in key.");
		return NULL;
	}
	CFMutableDictionaryRef query = key_query();
	CFDictionarySetValue(query, kSecAttrLabel, CFSTR(SIGN_IN_CACHE_NAME));
	CFDataRef data = CFDataCreate(NULL, bytes, KEY_BYTES);
	CFDictionarySetValue(query, kSecValueData, data);
	// The default ACL belongs to the calling signed Recordly app. This module
	// runs in Electron's main process; a separate executable would own the item.
	OSStatus status = SecItemAdd(query, NULL);
	CFRelease(data);
	CFRelease(query);
	if (status != errSecSuccess && status != errSecDuplicateItem)
		return keychain_error(env);
	napi_value result;
	return napi_get_boolean(env, status == errSecSuccess, &result) == napi_ok
		? result
		: keychain_error(env);
}

NAPI_MODULE_INIT() {
	const napi_property_descriptor operations[] = {
		{ .utf8name = "readKey", .method = read_key, .attributes = napi_default },
		{ .utf8name = "addKey", .method = add_key, .attributes = napi_default },
	};
	if (napi_define_properties(env, exports, 2, operations) != napi_ok)
		return keychain_error(env);
	return exports;
}
