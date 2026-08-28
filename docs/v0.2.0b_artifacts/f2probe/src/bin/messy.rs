pub fn messy_v020b(x: i32) -> i32 {
    let y = x * 2;
    let z: u32 = "wrong";
    y
}
fn main() {
    println!("{}", messy_v020b(21));
}
