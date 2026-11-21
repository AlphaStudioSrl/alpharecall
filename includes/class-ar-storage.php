<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Storage
{
    private const CIPHER = "AES-256-CBC";
    private const PREFIX_V2 = "v2:";

    public static function encrypt(string $plaintext): string
    {
        if ($plaintext === "") {
            return "";
        }
        $key = hash("sha256", wp_salt("auth"), true);
        $iv = random_bytes(16);
        $ciphertext = openssl_encrypt($plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        if ($ciphertext === false) {
            return "";
        }
        $mac = hash_hmac("sha256", $iv . $ciphertext, $key, true);
        return self::PREFIX_V2 . base64_encode($iv . $ciphertext . $mac);
    }

    public static function decrypt(string $payload): string
    {
        if ($payload === "") {
            return "";
        }
        $key = hash("sha256", wp_salt("auth"), true);
        if (str_starts_with($payload, self::PREFIX_V2)) {
            $encoded = substr($payload, strlen(self::PREFIX_V2));
            $decoded = base64_decode($encoded, true);
            if ($decoded === false || strlen($decoded) < (16 + 32)) {
                return "";
            }
            $iv = substr($decoded, 0, 16);
            $mac = substr($decoded, -32);
            $ciphertext = substr($decoded, 16, -32);
            $expected = hash_hmac("sha256", $iv . $ciphertext, $key, true);
            if (!hash_equals($expected, $mac)) {
                return "";
            }
            $plaintext = openssl_decrypt($ciphertext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
            return $plaintext === false ? "" : (string) $plaintext;
        }
        $decoded = base64_decode($payload, true);
        if ($decoded === false || strlen($decoded) < 17) {
            return "";
        }
        $iv = substr($decoded, 0, 16);
        $ciphertext = substr($decoded, 16);
        $plaintext = openssl_decrypt($ciphertext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        return $plaintext === false ? "" : (string) $plaintext;
    }
}
