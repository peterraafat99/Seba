/*
 * SEBA AI Tutor - ESP32 NFC RC522 Serial Reader
 * 
 * Hardware Connections (ESP32 to RC522 Reader):
 * --------------------------------------------
 * RC522 Pin  | ESP32 Pin
 * -----------|-----------
 * RST (Reset)| GPIO 22  (Any free digital pin, define RST_PIN)
 * SDA (SS)   | GPIO 21  (Any free digital pin, define SS_PIN)
 * MOSI       | GPIO 23  (Standard VSPI MOSI)
 * MISO       | GPIO 19  (Standard VSPI MISO)
 * SCK        | GPIO 18  (Standard VSPI SCK)
 * VCC        | 3.3V     (Do NOT connect to 5V!)
 * GND        | GND
 * 
 * Dependencies:
 * -------------
 * In Arduino IDE, go to Sketch -> Include Library -> Manage Libraries.
 * Search for "MFRC522" by GithubCommunity and install the latest version.
 */

#include <SPI.h>
#include <MFRC522.h>

#define RST_PIN   22     // Configurable reset pin
#define SS_PIN    21     // Configurable SDA (SS) pin

MFRC522 mfrc522(SS_PIN, RST_PIN);  // Create MFRC522 instance

void setup() {
  Serial.begin(115200);   // Initialize Serial communication at 115200 baud
  while (!Serial);        // Wait for serial port to connect (needed for native USB)
  
  SPI.begin();            // Init SPI bus
  mfrc522.PCD_Init();     // Init MFRC522 card reader
  
  Serial.println("--- ESP32 NFC RC522 Reader Ready ---");
  Serial.println("Scan an NFC card or key fob...");
}

void loop() {
  // Reset loop if no new card present on the sensor
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    return;
  }

  // Select one of the cards
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  // Extract the UID bytes and convert to Hex string
  String tagID = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) {
      tagID += "0";
    }
    tagID += String(mfrc522.uid.uidByte[i], HEX);
  }
  
  tagID.toUpperCase(); // Convert to uppercase for matching

  // Print the UID to the Serial output in the format the Python bridge expects
  Serial.print("NFC_TAG:");
  Serial.println(tagID);

  // Halt PICC to stop reading the same card multiple times
  mfrc522.PICC_HaltA();
  // Stop encryption on PCD
  mfrc522.PCD_StopCrypto1();
  
  delay(1500); // 1.5-second cooldown to prevent double scans
}
