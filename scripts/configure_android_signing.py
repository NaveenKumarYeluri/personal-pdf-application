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

if __name__ == '__main__':
    configure_android_signing()
