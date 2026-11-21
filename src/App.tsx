import { lichessBook } from "./bookData";
import { ExploreView } from "./ui/ExploreView";
import "./App.css";

const book = lichessBook();

export default function App() {
  return <ExploreView book={book} />;
}
