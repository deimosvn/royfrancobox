// ==============================================================================
// PROTOTIPO: Lentes de Asistencia Visual V2.0 - Infomatrix Nacional
// HARDWARE: Microcontrolador ESP32 Xiao Sense S3 + Batería LiPo
// ==============================================================================

$fn = 100; // Alta resolución para curvas suaves

// --- PARÁMETROS DEL MARCO ---
ancho_cara = 150;        // Ancho total de sien a sien
grosor_marco = 5;        // Grosor del plástico frontal
alto_marco = 22;         // Altura de los lentes (estilo deportivo/tech)
radio_curva_cara = 130;  // Radio de curvatura frontal

// --- DIMENSIONES EXACTAS ESP32 XIAO SENSE S3 ---
// Dimensiones de la placa: 21 x 17.5 mm. Se añade 0.5mm de tolerancia.
xiao_ancho = 18;    
xiao_alto = 21.5;   
xiao_prof = 7.5;    // Profundidad para incluir la placa y el sensor de cámara
radio_lente = 3.5;  // Radio del lente de la cámara
ancho_usb = 10;     // Ranura para el cable USB-C
alto_usb = 5;

// --- DIMENSIONES PARA OCULTAR BATERÍA LIPO (En patillas) ---
lipo_ancho = 22;
lipo_largo = 35;
lipo_prof = 6;


// ==============================================================================
// MÓDULO 1: MARCO FRONTAL
// ==============================================================================
module marco_frontal() {
    // Cálculo para posicionar los extremos (bisagras) en la curva
    y_extremos = radio_curva_cara - sqrt(pow(radio_curva_cara, 2) - pow(ancho_cara/2, 2));
    
    difference() {
        union() {
            // 1. Cuerpo principal curvado
            intersection() {
                difference() {
                    cylinder(r=radio_curva_cara, h=alto_marco, center=true);
                    cylinder(r=radio_curva_cara-grosor_marco, h=alto_marco+2, center=true);
                }
                // Cortar solo el ancho de la cara
                cube([ancho_cara, radio_curva_cara, alto_marco+2], center=true);
            }
            
            // 2. Módulo/Pod central para la cámara y el ESP32
            translate([0, radio_curva_cara - grosor_marco/2 + xiao_prof/2 - 1, 0])
                cube([xiao_ancho + 6, xiao_prof + 4, alto_marco], center=true);
                
            // 3. Soportes para las bisagras (Extremos)
            translate([ancho_cara/2 - 3, y_extremos - 2, 0])
                cube([6, 8, alto_marco], center=true);
            translate([-ancho_cara/2 + 3, y_extremos - 2, 0])
                cube([6, 8, alto_marco], center=true);
        }
        
        // --- RESTAS Y CORTES DEL MARCO FRONTAL ---
        
        // A. Hueco ergonómico para la nariz
        translate([0, radio_curva_cara - grosor_marco - 2, -alto_marco/2])
            scale([1, 1, 1.2])
            cylinder(r=12, h=15, center=true);
            
        // B. Cavidad de inserción superior para el ESP32 Xiao Sense S3
        // Abierto por arriba para deslizar la placa
        translate([0, radio_curva_cara + xiao_prof/2 - 1, 5])
            cube([xiao_ancho, xiao_prof, xiao_alto + 10], center=true);
            
        // C. Perforación frontal para la lente de la cámara
        translate([0, radio_curva_cara + xiao_prof + 2, 4])
            rotate([90, 0, 0])
            cylinder(r=radio_lente, h=10, center=true);
            
        // D. Acceso inferior para el puerto USB-C (programación in-situ)
        translate([0, radio_curva_cara + xiao_prof/2 - 1, -alto_marco/2 - 2])
            cube([ancho_usb, xiao_prof, 10], center=true);
            
        // E. Canaleta interna para pasar cables de batería a placa
        translate([0, radio_curva_cara - grosor_marco/2 + 1, 0])
            cube([ancho_cara - 15, 3, 4], center=true);
            
        // F. Cortes de Bisagra (Conectores Hembra) y pasadores
        translate([ancho_cara/2 - 3, y_extremos - 2, 0]) {
            cube([10, 10, 7.5], center=true); // Hueco para encaje
            cylinder(r=1.6, h=alto_marco+5, center=true); // Agujero para tornillo M3
        }
        translate([-ancho_cara/2 + 3, y_extremos - 2, 0]) {
            cube([10, 10, 7.5], center=true); 
            cylinder(r=1.6, h=alto_marco+5, center=true); 
        }
        
        // Limpieza de artefactos traseros de la intersección
        translate([0, radio_curva_cara - 50, 0])
            cube([300, 100, 50], center=true);
    }
}

// ==============================================================================
// MÓDULO 2: PATILLAS (DERECHA E IZQUIERDA)
// ==============================================================================
module patilla(es_derecha=true) {
    y_extremos = radio_curva_cara - sqrt(pow(radio_curva_cara, 2) - pow(ancho_cara/2, 2));
    
    // Función espejo para generar la izquierda o derecha automáticamente
    mirror([es_derecha ? 0 : 1, 0, 0]) {
        translate([ancho_cara/2 - 3, y_extremos - 2, 0]) {
            difference() {
                union() {
                    // 1. Bisagra Macho (Encaja en el marco)
                    cylinder(r=4, h=7, center=true);
                    
                    // 2. Cuerpo de la patilla (Engrosado para la electrónica)
                    translate([-2, -45, 0])
                        cube([lipo_prof + 4, 90, alto_marco], center=true);
                        
                    // 3. Caída ergonómica detrás de la oreja
                    translate([-2, -90, -10])
                        rotate([0, 90, 0])
                        cylinder(r=15, h=lipo_prof + 4, center=true);
                }
                
                // --- RESTAS DE LAS PATILLAS ---
                
                // A. Agujero para el tornillo/pasador de la bisagra (M3)
                cylinder(r=1.6, h=25, center=true);
                
                // B. Cavidad oculta para la batería LiPo / Módulo de carga
                translate([-2, -35, 0])
                    cube([lipo_prof, lipo_largo, lipo_ancho], center=true);
                    
                // C. Canal para pasar los cables hacia el marco frontal
                translate([-2, -15, 0])
                    cube([3, 100, 4], center=true);
                    
                // D. Suavizado y corte de la punta de la oreja
                translate([-10, -105, -25])
                    cube([20, 30, 30]);
            }
        }
    }
}

// ==============================================================================
// ENSAMBLAJE PARA VISUALIZACIÓN
// ==============================================================================
// Las piezas están armadas virtualmente. 
color("DimGray") marco_frontal();
color("Silver") patilla(es_derecha=true);
color("Silver") patilla(es_derecha=false);


// ==============================================================================
// INSTRUCCIONES PARA EXPORTAR A IMPRESIÓN 3D (STL):
// 1. Para imprimir el MARCO, comenta las dos líneas de "patilla" agregando "//" al inicio.
//    Luego renderiza (F6) y exporta. En tu laminador, acuesta el marco sobre la parte frontal plana.
// 2. Para imprimir las PATILLAS, comenta el "marco_frontal", renderiza y exporta. 
//    Acuéstalas de lado en la cama de impresión. No necesitarán casi soportes.
// ==============================================================================