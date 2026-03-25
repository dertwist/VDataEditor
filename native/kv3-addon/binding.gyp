{
  "targets": [
    {
      "target_name": "kv3addon",
      "sources": ["kv3-addon.cpp"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
            }
          }
        ],
        [
          "OS!='mac'",
          {
            "cflags_cc": ["-std=c++17"]
          }
        ]
      ]
    }
  ]
}

