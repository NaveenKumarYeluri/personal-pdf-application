import os
import sys

def configure_android_signing():
    gradle_path = os.path.join('android', 'app', 'build.gradle')
    if not os.path.exists(gradle_path):
        print(f"Warning: {gradle_path} not found.")
        return

    with open(gradle_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'signingConfigs' in content:
        print("signingConfigs already present in app/build.gradle.")
        return

    signing_block = """
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
"""

    if 'android {' in content:
        content = content.replace('android {', 'android {\n' + signing_block, 1)
    
    if 'buildTypes {' in content:
        content = content.replace(
            'buildTypes {',
            'buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }',
            1
        )

    with open(gradle_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print("Successfully injected persistent debug signing configuration into android/app/build.gradle")

def configure_android_manifest():
    manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')
    if not os.path.exists(manifest_path):
        print(f"Warning: {manifest_path} not found.")
        return

    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()

    permissions = """
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
    <uses-permission android:name="android.permission.INTERNET" />
"""
    if 'android.permission.READ_EXTERNAL_STORAGE' not in content and '<application' in content:
        content = content.replace('<application', permissions + '\n    <application', 1)
        with open(manifest_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Configured AndroidManifest permissions for storage and export.")

if __name__ == '__main__':
    configure_android_signing()
    configure_android_manifest()
