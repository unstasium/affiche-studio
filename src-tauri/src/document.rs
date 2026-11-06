use serde::{Deserialize, Serialize};

pub const DEFAULT_PALETTE: [&str; 5] = ["#0b0b0e", "#f3f3fc", "#cd4c51", "#843537", "#8a8a94"];

fn one() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f32,
    pub font_weight: u32,
    pub font_style: String,
    pub color: String,
    pub align: String,
    pub valign: String,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub text_transform: String,
    pub padding: f32,
    pub background: String,
    pub radius: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Inter".into(),
            font_size: 32.0,
            font_weight: 600,
            font_style: "normal".into(),
            color: "#f3f3fc".into(),
            align: "left".into(),
            valign: "top".into(),
            line_height: 1.2,
            letter_spacing: 0.0,
            text_transform: "none".into(),
            padding: 0.0,
            background: String::new(),
            radius: 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Layer {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub rotation: f32,
    pub opacity: f32,
    pub locked: bool,
    pub hidden: bool,
    pub group_id: Option<String>,
    pub text: String,
    pub style: TextStyle,
    pub src: String,
    pub fit: String,
    pub radius: f32,
    pub shape: String,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f32,
}

impl Default for Layer {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: "text".into(),
            name: "Calque".into(),
            x: 64.0,
            y: 64.0,
            w: 420.0,
            h: 120.0,
            rotation: 0.0,
            opacity: 1.0,
            locked: false,
            hidden: false,
            group_id: None,
            text: "Texte".into(),
            style: TextStyle::default(),
            src: String::new(),
            fit: "contain".into(),
            radius: 0.0,
            shape: "rect".into(),
            fill: "#cd4c51".into(),
            stroke: String::new(),
            stroke_width: 0.0,
        }
    }
}

impl Layer {
    pub fn text(name: &str, text: &str, x: f32, y: f32, w: f32, h: f32, size: f32) -> Self {
        let mut style = TextStyle::default();
        style.font_size = size;
        Self {
            kind: "text".into(),
            name: name.into(),
            text: text.into(),
            x,
            y,
            w,
            h,
            style,
            ..Default::default()
        }
    }

    pub fn shape(name: &str, shape: &str, x: f32, y: f32, w: f32, h: f32, fill: &str) -> Self {
        Self {
            kind: "shape".into(),
            name: name.into(),
            shape: shape.into(),
            fill: fill.into(),
            x,
            y,
            w,
            h,
            ..Default::default()
        }
    }

    fn normalize(&mut self, index: usize) {
        if self.id.trim().is_empty() {
            self.id = format!("layer-{}", uuid::Uuid::new_v4());
        }
        if !matches!(self.kind.as_str(), "text" | "image" | "shape") {
            self.kind = "shape".into();
        }
        if self.name.trim().is_empty() {
            self.name = format!("Calque {}", index + 1);
        }
        if !self.x.is_finite() {
            self.x = 0.0;
        }
        if !self.y.is_finite() {
            self.y = 0.0;
        }
        if !self.w.is_finite() || self.w < 8.0 {
            self.w = 200.0;
        }
        if !self.h.is_finite() || self.h < 8.0 {
            self.h = 80.0;
        }
        if !self.rotation.is_finite() {
            self.rotation = 0.0;
        }
        if !self.opacity.is_finite() {
            self.opacity = 1.0;
        }
        self.opacity = self.opacity.clamp(0.0, 1.0);
        if self.group_id.as_deref().map(str::trim).unwrap_or("").is_empty() {
            self.group_id = None;
        }
        self.style.font_size = self.style.font_size.clamp(4.0, 1200.0);
        if !self.style.line_height.is_finite() || self.style.line_height <= 0.0 {
            self.style.line_height = 1.2;
        }
        if self.style.font_family.trim().is_empty() {
            self.style.font_family = "Inter".into();
        }
        if self.style.color.trim().is_empty() {
            self.style.color = "#f3f3fc".into();
        }
        if !matches!(self.style.align.as_str(), "left" | "center" | "right" | "justify") {
            self.style.align = "left".into();
        }
        if !matches!(self.style.valign.as_str(), "top" | "middle" | "bottom") {
            self.style.valign = "top".into();
        }
        if self.style.background.is_empty() {
            self.style.background = String::new();
        }
        if !matches!(self.fit.as_str(), "cover" | "contain") {
            self.fit = "contain".into();
        }
        if !matches!(self.shape.as_str(), "rect" | "ellipse" | "line") {
            self.shape = "rect".into();
        }
        if self.kind == "shape" && self.fill.trim().is_empty() {
            self.fill = "#cd4c51".into();
        }
        self.stroke_width = self.stroke_width.max(0.0);
        self.radius = self.radius.max(0.0);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Document {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub palette: Vec<String>,
    pub layers: Vec<Layer>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: 2,
            width: 1080,
            height: 1920,
            background: "#0b0b0e".into(),
            palette: DEFAULT_PALETTE.iter().map(|c| c.to_string()).collect(),
            layers: Vec::new(),
        }
    }
}

impl Document {
    pub fn new(width: u32, height: u32, background: &str, palette: Vec<String>) -> Self {
        Self {
            version: 2,
            width,
            height,
            background: background.into(),
            palette,
            layers: Vec::new(),
        }
    }

    pub fn normalize(&mut self) {
        self.version = 2;
        self.width = self.width.clamp(200, 8000);
        self.height = self.height.clamp(200, 8000);
        if self.background.trim().is_empty() {
            self.background = "#0b0b0e".into();
        }
        if self.palette.len() < 2 {
            self.palette = DEFAULT_PALETTE.iter().map(|c| c.to_string()).collect();
        }
        self.palette.truncate(8);
        for (index, layer) in self.layers.iter_mut().enumerate() {
            layer.normalize(index);
        }
    }

    pub fn into_normalized(mut self) -> Self {
        self.normalize();
        self
    }
}
